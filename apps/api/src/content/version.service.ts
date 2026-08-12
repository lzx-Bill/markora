import { loadServerConfig } from "@markora/config";
import type {
  DocumentVersionDetail,
  DocumentVersionList,
  Principal,
  RestoreDocumentVersionRequest,
  RestoreDocumentVersionResult,
} from "@markora/contracts";
import { DocumentVersionReason, Prisma, ResourceState } from "@markora/database";
import { NamingPolicy } from "@markora/domain";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { CodedHttpException } from "../http/coded-http.exception.js";
import { visibleFolders } from "./content.repository.js";

@Injectable()
export class VersionService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  private readonly config = loadServerConfig(process.env);
  private readonly names = new NamingPolicy({
    maxCodePoints: this.config.WORKSPACE_NAME_MAX_CODE_POINTS,
  });

  public async list(
    principal: Principal,
    documentId: string,
    cursor?: string,
  ): Promise<DocumentVersionList> {
    await this.assertVisibleDocument(principal, documentId);
    const beforeVersionNo = cursor ? this.decodeCursor(cursor) : undefined;
    const versions = await this.database.client.documentVersion.findMany({
      where: {
        workspaceId: principal.workspaceId,
        documentId,
        ...(beforeVersionNo ? { versionNo: { lt: beforeVersionNo } } : {}),
      },
      include: { actor: { select: { id: true, displayName: true } } },
      orderBy: [{ versionNo: "desc" }, { id: "desc" }],
      take: 51,
    });
    const page = versions.slice(0, 50);
    return {
      data: page.map(versionSummary),
      retentionDays: this.config.VERSION_RETENTION_DAYS,
      nextCursor:
        versions.length > 50 && page.at(-1)
          ? Buffer.from(String(page.at(-1)?.versionNo), "utf8").toString("base64url")
          : null,
    };
  }

  public async get(
    principal: Principal,
    documentId: string,
    versionId: string,
  ): Promise<DocumentVersionDetail> {
    await this.assertVisibleDocument(principal, documentId);
    const version = await this.database.client.documentVersion.findFirst({
      where: { id: versionId, documentId, workspaceId: principal.workspaceId },
      include: { actor: { select: { id: true, displayName: true } } },
    });
    if (!version) this.notFound("Version");
    return {
      ...versionSummary(version),
      documentId: version.documentId,
      markdown: version.markdown,
    };
  }

  public async restore(
    principal: Principal,
    documentId: string,
    versionId: string,
    input: RestoreDocumentVersionRequest,
    requestId: string,
  ): Promise<RestoreDocumentVersionResult> {
    try {
      return await this.database.client.$transaction(
        async (transaction) => {
          const document = await this.findVisibleDocument(transaction, principal, documentId);
          if (!document) this.notFound("Document");
          const version = await transaction.documentVersion.findFirst({
            where: { id: versionId, documentId, workspaceId: principal.workspaceId },
          });
          if (!version) this.notFound("Version");
          if (document.revision !== input.baseRevision) this.revisionConflict(document);
          const historicalName = this.names.validate(version.documentName, "document");
          const nameConflict = await transaction.document.findFirst({
            where: {
              workspaceId: principal.workspaceId,
              folderId: document.folderId,
              normalizedName: historicalName.normalizedName,
              state: ResourceState.ACTIVE,
              id: { not: documentId },
            },
            select: { id: true },
          });
          if (nameConflict) {
            throw new CodedHttpException(
              "NAME_CONFLICT",
              "The historical document name is already in use. Rename the current item first.",
              409,
            );
          }
          const latestVersion = await transaction.documentVersion.aggregate({
            where: { documentId },
            _max: { versionNo: true },
          });
          const restoredAt = new Date();
          const safety = await transaction.documentVersion.create({
            data: {
              documentId,
              workspaceId: principal.workspaceId,
              versionNo: (latestVersion._max.versionNo ?? 0) + 1,
              markdown: document.markdown,
              documentName: document.name,
              reason: DocumentVersionReason.RESTORE,
              sourceRevision: document.revision,
              actorId: principal.userId,
              createdAt: restoredAt,
            },
          });
          await transaction.document.update({
            where: { id: documentId },
            data: {
              markdown: version.markdown,
              name: historicalName.name,
              normalizedName: historicalName.normalizedName,
              revision: { increment: 1 },
            },
          });
          await transaction.auditEvent.create({
            data: {
              actorUserId: principal.userId,
              workspaceId: principal.workspaceId,
              action: "document.version.restore",
              targetType: "document",
              targetId: documentId,
              result: "SUCCESS",
              requestId,
              metadata: {
                restoredVersionId: versionId,
                safetyVersionId: safety.id,
                fromRevision: document.revision,
                toRevision: document.revision + 1,
              },
            },
          });
          return {
            documentId,
            revision: document.revision + 1,
            restoredVersionId: versionId,
            safetyVersionId: safety.id,
            restoredAt: restoredAt.toISOString(),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof CodedHttpException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new CodedHttpException(
          "RESOURCE_STATE_CONFLICT",
          "The version history changed. Refresh and try again.",
          409,
        );
      }
      throw error;
    }
  }

  public async replaceProtected(
    principal: Principal,
    documentId: string,
    markdown: string,
    baseRevision: number,
    requestId: string,
  ): Promise<{ revision: number; safetyVersionId: string }> {
    if (Buffer.byteLength(markdown, "utf8") > this.config.DOCUMENT_MAX_BYTES) {
      throw new CodedHttpException("LIMIT_EXCEEDED", "The Markdown document is too large.", 413);
    }
    return this.database.client.$transaction(
      async (transaction) => {
        const document = await this.findVisibleDocument(transaction, principal, documentId);
        if (!document) this.notFound("Document");
        if (document.revision !== baseRevision) this.revisionConflict(document);
        const latest = await transaction.documentVersion.aggregate({
          where: { documentId },
          _max: { versionNo: true },
        });
        const safety = await transaction.documentVersion.create({
          data: {
            documentId,
            workspaceId: principal.workspaceId,
            versionNo: (latest._max.versionNo ?? 0) + 1,
            markdown: document.markdown,
            documentName: document.name,
            reason: DocumentVersionReason.IMPORT_REPLACE,
            sourceRevision: document.revision,
            actorId: principal.userId,
          },
        });
        await transaction.document.update({
          where: { id: documentId },
          data: { markdown, revision: { increment: 1 } },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: principal.userId,
            workspaceId: principal.workspaceId,
            action: "document.replace",
            targetType: "document",
            targetId: documentId,
            result: "SUCCESS",
            requestId,
            metadata: { fromRevision: document.revision, toRevision: document.revision + 1 },
          },
        });
        return { revision: document.revision + 1, safetyVersionId: safety.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async assertVisibleDocument(principal: Principal, documentId: string): Promise<void> {
    if (!(await this.findVisibleDocument(this.database.client, principal, documentId))) {
      this.notFound("Document");
    }
  }

  private async findVisibleDocument(
    client: Prisma.TransactionClient | typeof this.database.client,
    principal: Principal,
    documentId: string,
  ) {
    const document = await client.document.findFirst({
      where: { id: documentId, workspaceId: principal.workspaceId, state: ResourceState.ACTIVE },
    });
    if (!document) return null;
    const folders = await visibleFolders(client, principal.workspaceId);
    return document.folderId && !folders.some((folder) => folder.id === document.folderId)
      ? null
      : document;
  }

  private revisionConflict(document: {
    id: string;
    revision: number;
    markdown: string;
    updatedAt: Date;
  }): never {
    throw new CodedHttpException(
      "REVISION_CONFLICT",
      "The document changed after you opened it. Your local draft is still safe.",
      409,
      {
        documentId: document.id,
        serverRevision: document.revision,
        serverSavedAt: document.updatedAt.toISOString(),
        serverMarkdown: document.markdown,
      },
    );
  }

  private notFound(resource: string): never {
    throw new CodedHttpException("NOT_FOUND", `${resource} not found.`, 404);
  }

  private decodeCursor(cursor: string): number {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const value = Number(decoded);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new CodedHttpException("VALIDATION_FAILED", "The version cursor is invalid.", 400);
    }
    return value;
  }
}

function versionSummary(version: {
  id: string;
  versionNo: number;
  documentName: string;
  reason: "AUTO_SAVE" | "CONFLICT_OVERWRITE" | "RESTORE" | "IMPORT_REPLACE";
  sourceRevision: number;
  createdAt: Date;
  actor: { id: string; displayName: string };
}) {
  return {
    id: version.id,
    versionNo: version.versionNo,
    documentName: version.documentName,
    reason: version.reason,
    sourceRevision: version.sourceRevision,
    actor: version.actor,
    createdAt: version.createdAt.toISOString(),
  };
}
