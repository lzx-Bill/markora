import { createReadStream } from "node:fs";
import { resolve, sep } from "node:path";
import { loadServerConfig } from "@markora/config";
import type { CreateExportResult, ExportRequest, Principal } from "@markora/contracts";
import {
  BackgroundJobState,
  BackgroundJobType,
  Prisma,
  ResourceState,
  UserStatus,
} from "@markora/database";
import {
  portableArchiveComponent,
  safeDownloadName,
  uniqueArchivePath,
} from "@markora/portability";
import { Inject, Injectable } from "@nestjs/common";
import { visibleFolders } from "../content/content.repository.js";
import { jobDto } from "../content/trash.service.js";
import { DatabaseService } from "../database/database.service.js";
import { CodedHttpException } from "../http/coded-http.exception.js";
import { RuntimeConfigService } from "../runtime-config/runtime-config.service.js";
import { signExportDownload, verifyExportDownload } from "./export-token.js";

interface SnapshotItem {
  sourceDocumentId: string;
  displayPath: string;
  archivePath: string;
  markdown: string;
  sourceRevision: number;
  normalized: boolean;
}

@Injectable()
export class ExportService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  @Inject(RuntimeConfigService)
  private readonly runtimeConfig!: RuntimeConfigService;

  private readonly config = loadServerConfig(process.env);

  public async directDocument(principal: Principal, id: string, requestId: string) {
    const document = await this.database.client.document.findFirst({
      where: { id, workspaceId: principal.workspaceId, state: ResourceState.ACTIVE },
    });
    if (!document) throw new CodedHttpException("NOT_FOUND", "Document not found.", 404);
    if (document.folderId) {
      const reachable = await visibleFolders(this.database.client, principal.workspaceId);
      if (!reachable.some((folder) => folder.id === document.folderId)) {
        throw new CodedHttpException("NOT_FOUND", "Document not found.", 404);
      }
    }
    await this.database.client.auditEvent.create({
      data: {
        actorUserId: principal.userId,
        workspaceId: principal.workspaceId,
        action: "export.document.download",
        targetType: "document",
        targetId: document.id,
        result: "SUCCESS",
        requestId,
        metadata: { revision: document.revision },
      },
    });
    return { name: safeDownloadName(document.name), markdown: document.markdown };
  }

  public async create(
    principal: Principal,
    input: ExportRequest,
    requestId: string,
  ): Promise<CreateExportResult> {
    const { exportDownloadTtlMinutes } = await this.runtimeConfig.values();
    const expiresAt = new Date(Date.now() + exportDownloadTtlMinutes * 60_000);
    const job = await this.database.client.$transaction(
      async (transaction) => {
        const existing = await transaction.backgroundJob.findFirst({
          where: {
            ownerUserId: principal.userId,
            type: BackgroundJobType.EXPORT,
            idempotencyKey: input.idempotencyKey,
          },
        });
        if (existing) return existing;
        const snapshot = await this.snapshot(transaction, principal, input);
        if (snapshot.items.length === 0) {
          throw new CodedHttpException(
            "VALIDATION_FAILED",
            "The export contains no documents.",
            400,
          );
        }
        const created = await transaction.backgroundJob.create({
          data: {
            workspaceId: principal.workspaceId,
            ownerUserId: principal.userId,
            type: BackgroundJobType.EXPORT,
            targetType: "export",
            targetId:
              input.scope === "folder"
                ? (input.folderId as string)
                : input.scope === "selection"
                  ? (input.ids?.[0] as string)
                  : principal.workspaceId,
            idempotencyKey: input.idempotencyKey,
            payload: { downloadExpiresAt: expiresAt.toISOString() },
            checkpoint: {
              completed: 0,
              total: snapshot.items.length,
              currentItem: null,
              phase: "queued",
            },
            exportManifest: {
              create: {
                scope: input.scope,
                report: { mappings: snapshot.mappings },
                items: { create: snapshot.items },
              },
            },
            items: {
              create: snapshot.items.map((item) => ({
                sourceKey: item.sourceDocumentId,
                payload: { archivePath: item.archivePath, sourceRevision: item.sourceRevision },
              })),
            },
          },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: principal.userId,
            workspaceId: principal.workspaceId,
            action: "export.create",
            targetType: "job",
            targetId: created.id,
            result: "SUCCESS",
            requestId,
            metadata: { scope: input.scope, documents: snapshot.items.length },
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const tokenExpiresAt = exportExpiry(job.payload, expiresAt);
    return {
      accepted: true,
      job: jobDto(job),
      downloadToken: signExportDownload(
        {
          jobId: job.id,
          userId: principal.userId,
          workspaceId: principal.workspaceId,
          expiresAt: tokenExpiresAt.toISOString(),
        },
        this.config.SESSION_SECRET,
      ),
      expiresAt: tokenExpiresAt.toISOString(),
    };
  }

  public async download(principal: Principal, jobId: string, token: string, requestId: string) {
    const grant = verifyExportDownload(token, this.config.SESSION_SECRET);
    if (
      !grant ||
      grant.jobId !== jobId ||
      grant.userId !== principal.userId ||
      grant.workspaceId !== principal.workspaceId
    ) {
      throw new CodedHttpException(
        "FORBIDDEN",
        "Export download token is invalid or expired.",
        403,
      );
    }
    const job = await this.database.client.backgroundJob.findFirst({
      where: {
        id: jobId,
        workspaceId: principal.workspaceId,
        ownerUserId: principal.userId,
        type: BackgroundJobType.EXPORT,
      },
      include: { exportArtifact: true, owner: { select: { status: true } } },
    });
    if (!job) throw new CodedHttpException("NOT_FOUND", "Export job not found.", 404);
    if (job.owner.status !== UserStatus.ACTIVE) {
      throw new CodedHttpException("FORBIDDEN", "The export owner is no longer active.", 403);
    }
    if (job.state !== BackgroundJobState.SUCCEEDED || !job.exportArtifact) {
      throw new CodedHttpException("RESOURCE_STATE_CONFLICT", "Export is not ready.", 409);
    }
    if (job.exportArtifact.expiresAt <= new Date()) {
      throw new CodedHttpException("NOT_FOUND", "Export artifact expired.", 404);
    }
    const root = resolve(this.config.TEMP_ROOT, "exports");
    const path = resolve(job.exportArtifact.filePath);
    if (!path.startsWith(`${root}${sep}`)) {
      throw new CodedHttpException("NOT_FOUND", "Export artifact is unavailable.", 404);
    }
    await this.database.client.auditEvent.create({
      data: {
        actorUserId: principal.userId,
        workspaceId: principal.workspaceId,
        action: "export.download",
        targetType: "job",
        targetId: job.id,
        result: "SUCCESS",
        requestId,
        metadata: { bytes: job.exportArtifact.byteSize.toString() },
      },
    });
    return { name: `markora-export-${job.id.slice(0, 8)}.zip`, stream: createReadStream(path) };
  }

  private async snapshot(
    transaction: Prisma.TransactionClient,
    principal: Principal,
    input: ExportRequest,
  ): Promise<{ items: SnapshotItem[]; mappings: { from: string; to: string }[] }> {
    const folders = await visibleFolders(transaction, principal.workspaceId);
    const documents = await transaction.document.findMany({
      where: { workspaceId: principal.workspaceId, state: ResourceState.ACTIVE },
      orderBy: [{ folderId: "asc" }, { normalizedName: "asc" }, { id: "asc" }],
    });
    const reachableIds = new Set(folders.map((folder) => folder.id));
    const reachableDocuments = documents.filter(
      (document) => document.folderId === null || reachableIds.has(document.folderId),
    );
    const selectedFolderIds = new Set<string>();
    const selectedDocumentIds = new Set<string>();
    let includeBaseFolder = false;
    if (input.scope === "workspace") {
      for (const folder of folders) selectedFolderIds.add(folder.id);
      for (const document of reachableDocuments) selectedDocumentIds.add(document.id);
    } else if (input.scope === "folder") {
      const folder = folders.find(({ id }) => id === input.folderId);
      if (!folder) throw new CodedHttpException("NOT_FOUND", "Export folder not found.", 404);
      includeBaseFolder = true;
      collectDescendants(folder.id, folders, selectedFolderIds);
      for (const document of reachableDocuments) {
        if (document.folderId && selectedFolderIds.has(document.folderId)) {
          selectedDocumentIds.add(document.id);
        }
      }
    } else {
      const requested = new Set(input.ids ?? []);
      for (const folder of folders) {
        if (requested.has(folder.id)) {
          collectDescendants(folder.id, folders, selectedFolderIds);
        }
      }
      for (const document of reachableDocuments) {
        if (requested.has(document.id)) selectedDocumentIds.add(document.id);
        if (document.folderId && selectedFolderIds.has(document.folderId)) {
          selectedDocumentIds.add(document.id);
        }
      }
      const known = new Set([...selectedFolderIds, ...selectedDocumentIds]);
      if ([...requested].some((id) => !known.has(id))) {
        throw new CodedHttpException("NOT_FOUND", "An export selection item was not found.", 404);
      }
      includeBaseFolder = true;
    }
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    const used = new Set<string>();
    const mappings: { from: string; to: string }[] = [];
    const items = reachableDocuments
      .filter((document) => selectedDocumentIds.has(document.id))
      .map((document) => {
        const rawFolders = folderPath(document.folderId, folderById, input, includeBaseFolder);
        const rawPath = [...rawFolders, document.name].join("/");
        let normalized = false;
        const rawComponents = [...rawFolders, document.name];
        const componentBudget = Math.max(
          4,
          Math.floor(
            (this.config.EXPORT_PATH_MAX_BYTES - Math.max(0, rawComponents.length - 1)) /
              rawComponents.length,
          ),
        );
        const components = rawComponents.map((component, index, all) => {
          const portable = portableArchiveComponent(
            component,
            index === all.length - 1 ? "document.md" : "folder",
          );
          normalized ||= portable.normalized;
          const limited = limitUtf8(portable.name, componentBudget, index === all.length - 1);
          normalized ||= limited !== portable.name;
          return limited;
        });
        let archivePath = components.join("/");
        const unique = uniqueArchivePath(archivePath, used);
        normalized ||= unique !== archivePath;
        archivePath = unique;
        if (normalized) mappings.push({ from: rawPath, to: archivePath });
        return {
          sourceDocumentId: document.id,
          displayPath: rawPath,
          archivePath,
          markdown: document.markdown,
          sourceRevision: document.revision,
          normalized,
        };
      });
    return { items, mappings };
  }
}

function collectDescendants(
  rootId: string,
  folders: readonly { id: string; parentId: string | null }[],
  result: Set<string>,
): void {
  const queue = [rootId];
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    if (!id || result.has(id)) continue;
    result.add(id);
    queue.push(...folders.filter((folder) => folder.parentId === id).map((folder) => folder.id));
  }
}

function folderPath(
  folderId: string | null,
  folders: Map<string, { id: string; parentId: string | null; name: string }>,
  input: ExportRequest,
  includeBase: boolean,
): string[] {
  const path: { id: string; name: string }[] = [];
  let current = folderId ? folders.get(folderId) : undefined;
  while (current) {
    path.unshift({ id: current.id, name: current.name });
    current = current.parentId ? folders.get(current.parentId) : undefined;
  }
  if (input.scope === "folder" && includeBase) {
    const base = path.findIndex(({ id }) => id === input.folderId);
    return base >= 0 ? path.slice(base).map(({ name }) => name) : [];
  }
  if (input.scope === "selection" && includeBase) {
    const selected = new Set(input.ids ?? []);
    const base = path.findIndex(({ id }) => selected.has(id));
    return base >= 0 ? path.slice(base).map(({ name }) => name) : path.map(({ name }) => name);
  }
  return path.map(({ name }) => name);
}

function limitUtf8(input: string, maxBytes: number, document: boolean): string {
  if (Buffer.byteLength(input, "utf8") <= maxBytes) return input;
  const extension = document && input.toLocaleLowerCase().endsWith(".md") ? ".md" : "";
  const source = extension ? input.slice(0, -3) : input;
  let output = "";
  for (const character of source) {
    if (Buffer.byteLength(`${output}${character}${extension}`, "utf8") > maxBytes) break;
    output += character;
  }
  return `${output || (document ? "d" : "f")}${extension}`;
}

function exportExpiry(payload: unknown, fallback: Date): Date {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const value = (payload as Record<string, unknown>).downloadExpiresAt;
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value);
  }
  return fallback;
}
