import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { loadServerConfig } from "@markora/config";
import type {
  AcceptedJob,
  ExecuteImportRequest,
  ImportPreviewRequest,
  ImportPreviewResult,
  ImportUploadResult,
  Principal,
} from "@markora/contracts";
import { BackgroundJobType, Prisma, ResourceState } from "@markora/database";
import { InvalidNameError, NamingPolicy } from "@markora/domain";
import {
  extractMarkdownZip,
  privatePath,
  registerMarkdownFile,
  UnsafeArchiveError,
  validateArchivePath,
} from "@markora/portability";
import { Inject, Injectable } from "@nestjs/common";
import type { Express } from "express";
import { visibleFolders } from "../content/content.repository.js";
import { jobDto } from "../content/trash.service.js";
import { DatabaseService } from "../database/database.service.js";
import { CodedHttpException } from "../http/coded-http.exception.js";
import {
  type StoredImportPreview,
  StoredImportPreviewSchema,
  StoredUploadManifestSchema,
} from "./import-plan.js";

@Injectable()
export class ImportService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  private readonly config = loadServerConfig(process.env);
  private readonly names = new NamingPolicy({
    maxCodePoints: this.config.WORKSPACE_NAME_MAX_CODE_POINTS,
  });

  public async upload(
    principal: Principal,
    files: readonly Express.Multer.File[],
    rawPaths: unknown,
    requestId: string,
  ): Promise<ImportUploadResult> {
    if (files.length === 0 || files.length > this.config.IMPORT_MAX_FILES) {
      throw new CodedHttpException(
        "LIMIT_EXCEEDED",
        "Choose at least one file within the configured count limit.",
        413,
      );
    }
    const directory = dirname(files[0]?.path ?? "");
    try {
      if (files.some((file) => dirname(file.path) !== directory)) {
        throw new CodedHttpException(
          "UNSAFE_ARCHIVE",
          "Upload files were not isolated in one temporary workspace.",
          400,
        );
      }
      const paths = parseRelativePaths(rawPaths, files);
      const zipFiles = paths.filter((path) => extname(path).toLocaleLowerCase() === ".zip");
      if (zipFiles.length > 0 && (zipFiles.length !== 1 || files.length !== 1)) {
        throw new CodedHttpException(
          "VALIDATION_FAILED",
          "Upload one ZIP by itself, or upload files/folders without a ZIP.",
          400,
        );
      }
      let totalBytes = 0;
      const entries = [];
      for (const [index, file] of files.entries()) {
        const relativePath = validateArchivePath(
          paths[index] ?? file.originalname,
          this.config.WORKSPACE_MAX_DEPTH,
        );
        const bytes = file.size;
        totalBytes += bytes;
        if (totalBytes > this.config.IMPORT_UPLOAD_MAX_BYTES) {
          throw new CodedHttpException(
            "LIMIT_EXCEEDED",
            "Upload exceeds the configured compressed/input size limit.",
            413,
          );
        }
        const content = await readFile(file.path);
        entries.push({
          relativePath,
          storageName: basename(file.path),
          sha256: createHash("sha256").update(content).digest("hex"),
          bytes,
          kind:
            extname(relativePath).toLocaleLowerCase() === ".zip"
              ? ("ZIP" as const)
              : ("FILE" as const),
        });
      }
      const manifest = StoredUploadManifestSchema.parse({ entries });
      const manifestHash = hashJson(manifest);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + this.config.IMPORT_UPLOAD_TTL_MINUTES * 60_000);
      const upload = await this.database.client.$transaction(async (transaction) => {
        const created = await transaction.importUpload.create({
          data: {
            workspaceId: principal.workspaceId,
            ownerUserId: principal.userId,
            tokenHash: hashToken(token),
            tempPath: resolve(directory),
            manifestHash,
            manifest,
            expiresAt,
          },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: principal.userId,
            workspaceId: principal.workspaceId,
            action: "import.upload",
            targetType: "import-upload",
            targetId: created.id,
            result: "SUCCESS",
            requestId,
            metadata: { filesReceived: files.length, bytes: totalBytes },
          },
        });
        return created;
      });
      return {
        uploadToken: token,
        filesReceived: files.length,
        expiresAt: upload.expiresAt.toISOString(),
      };
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw mapImportError(error);
    }
  }

  public async preview(
    principal: Principal,
    input: ImportPreviewRequest,
    requestId: string,
  ): Promise<ImportPreviewResult> {
    const upload = await this.database.client.importUpload.findFirst({
      where: {
        tokenHash: hashToken(input.uploadToken),
        workspaceId: principal.workspaceId,
        ownerUserId: principal.userId,
        expiresAt: { gt: new Date() },
      },
    });
    if (!upload)
      throw new CodedHttpException(
        "PLAN_EXPIRED",
        "The upload token is invalid or expired. Upload the files again.",
        410,
      );
    if (
      input.targetFolderId &&
      !(await visibleFolders(this.database.client, principal.workspaceId)).some(
        ({ id }) => id === input.targetFolderId,
      )
    ) {
      throw new CodedHttpException("NOT_FOUND", "Import target folder not found.", 404);
    }
    try {
      const manifest = StoredUploadManifestSchema.parse(upload.manifest);
      if (hashJson(manifest) !== upload.manifestHash)
        this.unsafe("Upload manifest changed after acceptance.");
      await this.verifyUploadFiles(upload.tempPath, manifest);
      const planId = randomUUID();
      const extractedDirectory = privatePath(upload.tempPath, `plan_${planId.replaceAll("-", "")}`);
      let ignoredNonMarkdown = 0;
      const extracted = [];
      if (manifest.entries[0]?.kind === "ZIP") {
        const archive = await extractMarkdownZip(
          resolveContained(upload.tempPath, manifest.entries[0].storageName),
          extractedDirectory,
          this.archiveLimits(),
        );
        ignoredNonMarkdown = archive.ignoredCount;
        extracted.push(...archive.entries);
      } else {
        const seen = new Set<string>();
        for (const entry of manifest.entries) {
          if (extname(entry.relativePath).toLocaleLowerCase() !== ".md") {
            ignoredNonMarkdown += 1;
            continue;
          }
          const folded = entry.relativePath.normalize("NFC").toLocaleLowerCase();
          if (seen.has(folded)) this.unsafe("Upload contains duplicate normalized paths.");
          seen.add(folded);
          extracted.push(
            await registerMarkdownFile(
              resolveContained(upload.tempPath, entry.storageName),
              entry.relativePath,
              this.archiveLimits(),
            ),
          );
        }
      }
      if (extracted.length === 0) {
        throw new CodedHttpException(
          "VALIDATION_FAILED",
          "No valid Markdown files were found.",
          400,
        );
      }
      const analyzed = await this.analyze(
        principal.workspaceId,
        input.targetFolderId,
        extracted,
        upload.tempPath,
      );
      const preview: StoredImportPreview = {
        targetFolderId: input.targetFolderId,
        summary: {
          documents: analyzed.items.length,
          folders: analyzed.folderCount,
          ignoredNonMarkdown,
          conflicts: analyzed.items.filter((item) => item.status === "CONFLICT").length,
          normalized: analyzed.items.filter((item) => item.status === "NORMALIZED").length,
          totalBytes: analyzed.items.reduce((total, item) => total + item.bytes, 0),
        },
        items: analyzed.items,
        warnings:
          ignoredNonMarkdown > 0
            ? [
                {
                  code: "IGNORED_NON_MARKDOWN",
                  message: "Non-Markdown files will be ignored.",
                  count: ignoredNonMarkdown,
                },
              ]
            : [],
      };
      const manifestHash = hashJson({
        upload: upload.manifestHash,
        targetFolderId: input.targetFolderId,
        items: preview.items.map(({ sourceKey, sourcePath, sha256, bytes }) => ({
          sourceKey,
          sourcePath,
          sha256,
          bytes,
        })),
      });
      const expiresAt = new Date(
        Math.min(
          upload.expiresAt.getTime(),
          Date.now() + this.config.IMPORT_PLAN_TTL_MINUTES * 60_000,
        ),
      );
      const plan = await this.database.client.$transaction(async (transaction) => {
        const created = await transaction.importPlan.create({
          data: {
            id: planId,
            uploadId: upload.id,
            workspaceId: principal.workspaceId,
            ownerUserId: principal.userId,
            targetFolderId: input.targetFolderId,
            manifestHash,
            preview,
            expiresAt,
          },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: principal.userId,
            workspaceId: principal.workspaceId,
            action: "import.preview",
            targetType: "import-plan",
            targetId: created.id,
            result: "SUCCESS",
            requestId,
            metadata: {
              documents: preview.summary.documents,
              conflicts: preview.summary.conflicts,
              ignoredNonMarkdown,
            },
          },
        });
        return created;
      });
      return publicPreview(plan.id, preview, plan.expiresAt);
    } catch (error) {
      throw mapImportError(error);
    }
  }

  public async execute(
    principal: Principal,
    planId: string,
    input: ExecuteImportRequest,
    requestId: string,
  ): Promise<AcceptedJob> {
    return this.database.client.$transaction(
      async (transaction) => {
        const existing = await transaction.backgroundJob.findFirst({
          where: {
            ownerUserId: principal.userId,
            type: BackgroundJobType.IMPORT,
            idempotencyKey: input.idempotencyKey,
          },
        });
        if (existing) return { accepted: true, job: jobDto(existing) };
        const plan = await transaction.importPlan.findFirst({
          where: { id: planId, workspaceId: principal.workspaceId, ownerUserId: principal.userId },
          include: { upload: true },
        });
        if (!plan || plan.expiresAt <= new Date() || plan.upload.expiresAt <= new Date()) {
          throw new CodedHttpException(
            "PLAN_EXPIRED",
            "The import plan expired. Preview the upload again.",
            410,
          );
        }
        if (plan.executedJobId) {
          throw new CodedHttpException(
            "RESOURCE_STATE_CONFLICT",
            "This import plan has already been executed.",
            409,
          );
        }
        if (
          plan.targetFolderId &&
          !(await visibleFolders(transaction, principal.workspaceId)).some(
            ({ id }) => id === plan.targetFolderId,
          )
        ) {
          throw new CodedHttpException(
            "NOT_FOUND",
            "Import target folder is no longer available.",
            404,
          );
        }
        const preview = StoredImportPreviewSchema.parse(plan.preview);
        const expectedHash = hashJson({
          upload: plan.upload.manifestHash,
          targetFolderId: plan.targetFolderId,
          items: preview.items.map(({ sourceKey, sourcePath, sha256, bytes }) => ({
            sourceKey,
            sourcePath,
            sha256,
            bytes,
          })),
        });
        if (expectedHash !== plan.manifestHash)
          this.unsafe("Import plan manifest changed after preview.");
        const overrideMap = new Map(
          input.overrides.map((override) => [override.sourceKey, override.strategy]),
        );
        if (
          [...overrideMap.keys()].some(
            (key) => !preview.items.some((item) => item.sourceKey === key),
          )
        ) {
          throw new CodedHttpException(
            "VALIDATION_FAILED",
            "An import conflict override references an unknown item.",
            400,
          );
        }
        const job = await transaction.backgroundJob.create({
          data: {
            workspaceId: principal.workspaceId,
            ownerUserId: principal.userId,
            type: BackgroundJobType.IMPORT,
            targetType: "import-plan",
            targetId: plan.id,
            idempotencyKey: input.idempotencyKey,
            payload: { planId: plan.id, uploadId: plan.uploadId },
            checkpoint: {
              completed: 0,
              total: preview.items.length,
              currentItem: null,
              phase: "queued",
            },
            items: {
              create: preview.items.map((item) => ({
                sourceKey: item.sourceKey,
                payload: {
                  ...item,
                  strategy: overrideMap.get(item.sourceKey) ?? input.conflictStrategy,
                },
              })),
            },
          },
        });
        await transaction.importPlan.update({
          where: { id: plan.id },
          data: { executedJobId: job.id },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: principal.userId,
            workspaceId: principal.workspaceId,
            action: "import.execute",
            targetType: "job",
            targetId: job.id,
            result: "SUCCESS",
            requestId,
            metadata: {
              planId: plan.id,
              items: preview.items.length,
              strategy: input.conflictStrategy,
            },
          },
        });
        return { accepted: true, job: jobDto(job) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async analyze(
    workspaceId: string,
    targetFolderId: string | null,
    entries: readonly {
      sourceKey: string;
      relativePath: string;
      storagePath: string;
      sha256: string;
      bytes: number;
    }[],
    uploadRoot: string,
  ) {
    const folders = await this.database.client.folder.findMany({
      where: { workspaceId, state: ResourceState.ACTIVE },
    });
    const documents = await this.database.client.document.findMany({
      where: { workspaceId, state: ResourceState.ACTIVE },
    });
    const folderByParentAndName = new Map(
      folders.map((folder) => [`${folder.parentId ?? "root"}:${folder.normalizedName}`, folder]),
    );
    const documentKeys = new Set(
      documents.map((document) => `${document.folderId ?? "root"}:${document.normalizedName}`),
    );
    const importedKeys = new Set<string>();
    const directoryPaths = new Set<string>();
    const items = entries.map((entry) => {
      const segments = entry.relativePath.split("/");
      const rawDocumentName = segments.pop();
      if (!rawDocumentName) this.invalidName(entry.relativePath);
      const directoryNames = segments.map(
        (segment) => this.validatedName(segment, "folder", entry.relativePath).name,
      );
      const extensionNormalized = `${rawDocumentName.slice(0, -3)}.md`;
      const documentName = this.validatedName(
        extensionNormalized,
        "document",
        entry.relativePath,
      ).name;
      let parentId: string | null | undefined = targetFolderId;
      let virtualPath = targetFolderId ?? "root";
      for (const directoryName of directoryNames) {
        const validated = this.names.validate(directoryName, "folder");
        directoryPaths.add(`${virtualPath}/${validated.normalizedName}`);
        if (parentId !== undefined) {
          const existing = folderByParentAndName.get(
            `${parentId ?? "root"}:${validated.normalizedName}`,
          );
          parentId = existing?.id;
        }
        virtualPath = `${virtualPath}/${validated.normalizedName}`;
      }
      const validatedDocument = this.names.validate(documentName, "document");
      const importKey = `${virtualPath}:${validatedDocument.normalizedName}`;
      const conflict =
        importedKeys.has(importKey) ||
        (parentId !== undefined &&
          documentKeys.has(`${parentId ?? "root"}:${validatedDocument.normalizedName}`));
      importedKeys.add(importKey);
      const targetPath = [...directoryNames, documentName].join("/");
      const normalized = targetPath !== entry.relativePath;
      return {
        sourceKey: entry.sourceKey,
        sourcePath: entry.relativePath,
        targetPath,
        directoryNames,
        documentName,
        storageRelativePath: relative(uploadRoot, entry.storagePath).replaceAll("\\", "/"),
        sha256: entry.sha256,
        bytes: entry.bytes,
        status: conflict
          ? ("CONFLICT" as const)
          : normalized
            ? ("NORMALIZED" as const)
            : ("READY" as const),
      };
    });
    return { items, folderCount: directoryPaths.size };
  }

  private validatedName(input: string, kind: "folder" | "document", sourcePath: string) {
    try {
      return this.names.validate(input, kind);
    } catch (error) {
      if (error instanceof InvalidNameError) this.invalidName(sourcePath, error.reason);
      throw error;
    }
  }

  private invalidName(sourcePath: string, reason?: string): never {
    throw new CodedHttpException(
      "INVALID_NAME",
      "An import path contains an invalid workspace name.",
      422,
      { sourcePath, reason },
    );
  }

  private async verifyUploadFiles(
    root: string,
    manifest: ReturnType<typeof StoredUploadManifestSchema.parse>,
  ) {
    for (const entry of manifest.entries) {
      const content = await readFile(resolveContained(root, entry.storageName));
      if (
        content.length !== entry.bytes ||
        createHash("sha256").update(content).digest("hex") !== entry.sha256
      ) {
        this.unsafe("Uploaded bytes changed after acceptance.");
      }
    }
  }

  private archiveLimits() {
    return {
      maxFiles: this.config.IMPORT_MAX_FILES,
      maxTotalBytes: this.config.IMPORT_MAX_TOTAL_BYTES,
      maxEntryBytes: this.config.DOCUMENT_MAX_BYTES,
      maxCompressionRatio: this.config.IMPORT_MAX_COMPRESSION_RATIO,
      maxDepth: this.config.WORKSPACE_MAX_DEPTH,
    };
  }

  private unsafe(message: string): never {
    throw new CodedHttpException("UNSAFE_ARCHIVE", message, 400);
  }
}

function parseRelativePaths(raw: unknown, files: readonly Express.Multer.File[]): string[] {
  if (raw === undefined) return files.map((file) => repairMultipartName(file.originalname));
  try {
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== files.length ||
      parsed.some((path) => typeof path !== "string")
    )
      throw new Error("invalid paths");
    return parsed as string[];
  } catch {
    throw new CodedHttpException(
      "VALIDATION_FAILED",
      "relativePaths must be a JSON array matching the uploaded files.",
      400,
    );
  }
}

function repairMultipartName(name: string): string {
  const repaired = Buffer.from(name, "latin1").toString("utf8");
  return repaired.includes("�") ? name : repaired;
}

function resolveContained(root: string, child: string): string {
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, child);
  if (
    resolved === resolvedRoot ||
    (!resolved.startsWith(`${resolvedRoot}\\`) && !resolved.startsWith(`${resolvedRoot}/`))
  ) {
    throw new CodedHttpException(
      "UNSAFE_ARCHIVE",
      "Temporary import path escaped its workspace.",
      400,
    );
  }
  return resolved;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function publicPreview(
  id: string,
  preview: StoredImportPreview,
  expiresAt: Date,
): ImportPreviewResult {
  return {
    planId: id,
    targetFolderId: preview.targetFolderId,
    summary: preview.summary,
    items: preview.items.map(({ sourceKey, sourcePath, targetPath, bytes, status }) => ({
      sourceKey,
      sourcePath,
      targetPath,
      bytes,
      status,
    })),
    warnings: preview.warnings,
    expiresAt: expiresAt.toISOString(),
  };
}

function mapImportError(error: unknown): unknown {
  if (error instanceof CodedHttpException) return error;
  if (error instanceof UnsafeArchiveError) {
    if (error.reason === "invalid_encoding")
      return new CodedHttpException("INVALID_ENCODING", error.message, 422);
    if (["file_count", "entry_size", "total_size"].includes(error.reason))
      return new CodedHttpException("LIMIT_EXCEEDED", error.message, 413);
    return new CodedHttpException("UNSAFE_ARCHIVE", error.message, 400, { reason: error.reason });
  }
  return error;
}
