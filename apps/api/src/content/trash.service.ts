import { loadServerConfig } from "@markora/config";
import type {
  PermanentDeleteResult,
  Principal,
  RestoreResourceRequest,
  RestoreResourceResult,
  TrashList,
} from "@markora/contracts";
import { BackgroundJobState, BackgroundJobType, Prisma, ResourceState } from "@markora/database";
import { analyzeHierarchy, NamingPolicy } from "@markora/domain";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { CodedHttpException } from "../http/coded-http.exception.js";
import { visibleFolders } from "./content.repository.js";

@Injectable()
export class TrashService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  private readonly config = loadServerConfig(process.env);
  private readonly names = new NamingPolicy({
    maxCodePoints: this.config.WORKSPACE_NAME_MAX_CODE_POINTS,
  });

  public async list(
    principal: Principal,
    type?: "FOLDER" | "DOCUMENT",
    cursor?: string,
  ): Promise<TrashList> {
    const [folders, documents] = await Promise.all([
      this.database.client.folder.findMany({
        where: {
          workspaceId: principal.workspaceId,
          state: { in: [ResourceState.TRASHED, ResourceState.DELETING] },
        },
        orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
      }),
      this.database.client.document.findMany({
        where: {
          workspaceId: principal.workspaceId,
          state: { in: [ResourceState.TRASHED, ResourceState.DELETING] },
        },
        orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
      }),
    ]);
    const allFolders = await this.database.client.folder.findMany({
      where: { workspaceId: principal.workspaceId },
      select: { id: true, parentId: true, state: true },
    });
    const byId = new Map(allFolders.map((folder) => [folder.id, folder]));
    const beneathTrash = (folderId: string | null): boolean => {
      let cursor = folderId ? byId.get(folderId) : undefined;
      while (cursor) {
        if (cursor.state !== ResourceState.ACTIVE) return true;
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
      return false;
    };
    const folderItems = folders
      .filter((folder) => !beneathTrash(folder.parentId))
      .map((folder) => this.trashItem(folder, "FOLDER"));
    const documentItems = documents
      .filter((document) => !beneathTrash(document.folderId))
      .map((document) => this.trashItem(document, "DOCUMENT"));
    let data = [
      ...(type === "DOCUMENT" ? [] : folderItems),
      ...(type === "FOLDER" ? [] : documentItems),
    ].sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
    if (cursor) {
      const decoded = this.decodeTrashCursor(cursor);
      const index = data.findIndex(
        (item) =>
          item.id === decoded.id &&
          item.type === decoded.type &&
          item.deletedAt === decoded.deletedAt,
      );
      if (index < 0) {
        throw new CodedHttpException(
          "VALIDATION_FAILED",
          "The Trash cursor is invalid or expired.",
          400,
        );
      }
      data = data.slice(index + 1);
    }
    const page = data.slice(0, 50);
    const last = page.at(-1);
    return {
      data: page,
      retentionDays: this.config.TRASH_RETENTION_DAYS,
      nextCursor:
        data.length > 50 && last
          ? Buffer.from(
              JSON.stringify({ id: last.id, type: last.type, deletedAt: last.deletedAt }),
              "utf8",
            ).toString("base64url")
          : null,
    };
  }

  public restoreFolder(
    principal: Principal,
    folderId: string,
    input: RestoreResourceRequest,
    requestId: string,
  ): Promise<RestoreResourceResult> {
    return this.restore(principal, "folder", folderId, input, requestId);
  }

  public restoreDocument(
    principal: Principal,
    documentId: string,
    input: RestoreResourceRequest,
    requestId: string,
  ): Promise<RestoreResourceResult> {
    return this.restore(principal, "document", documentId, input, requestId);
  }

  public deleteFolder(
    principal: Principal,
    folderId: string,
    requestId: string,
  ): Promise<PermanentDeleteResult> {
    return this.enqueueDelete(principal, "folder", folderId, requestId);
  }

  public deleteDocument(
    principal: Principal,
    documentId: string,
    requestId: string,
  ): Promise<PermanentDeleteResult> {
    return this.enqueueDelete(principal, "document", documentId, requestId);
  }

  private async restore(
    principal: Principal,
    kind: "folder" | "document",
    id: string,
    input: RestoreResourceRequest,
    requestId: string,
  ): Promise<RestoreResourceResult> {
    try {
      return await this.database.client.$transaction(
        async (transaction) => {
          const folder =
            kind === "folder"
              ? await transaction.folder.findFirst({
                  where: { id, workspaceId: principal.workspaceId, state: ResourceState.TRASHED },
                })
              : null;
          const document =
            kind === "document"
              ? await transaction.document.findFirst({
                  where: { id, workspaceId: principal.workspaceId, state: ResourceState.TRASHED },
                })
              : null;
          const item = folder ?? document;
          if (!item) this.notFound(kind === "folder" ? "Folder" : "Document");
          const visible = await visibleFolders(transaction, principal.workspaceId);
          const originalId = folder
            ? folder.originalParentId
            : (document?.originalFolderId ?? null);
          const originalWasRoot = folder
            ? folder.originalParentIsRoot
            : (document?.originalFolderIsRoot ?? false);
          const targetId = input.targetParentId !== undefined ? input.targetParentId : originalId;
          if (targetId === null && input.targetParentId === undefined && !originalWasRoot) {
            this.targetRequired();
          }
          if (targetId !== null && !visible.some((folder) => folder.id === targetId)) {
            this.targetRequired();
          }
          if (kind === "folder") {
            const allFolders = await transaction.folder.findMany({
              where: { workspaceId: principal.workspaceId },
            });
            const descendants = new Set<string>([id]);
            for (let changed = true; changed; ) {
              changed = false;
              for (const folder of allFolders) {
                if (
                  folder.parentId &&
                  descendants.has(folder.parentId) &&
                  !descendants.has(folder.id)
                ) {
                  descendants.add(folder.id);
                  changed = true;
                }
              }
            }
            if (targetId && descendants.has(targetId)) {
              throw new CodedHttpException(
                "FOLDER_CYCLE",
                "A folder cannot be restored into its subtree.",
                422,
              );
            }
            const targetDepth = targetId
              ? (analyzeHierarchy(visible).depthById.get(targetId) ?? 0)
              : 0;
            const depths = new Map<string, number>([[id, 1]]);
            for (let changed = true; changed; ) {
              changed = false;
              for (const folder of allFolders) {
                const parentDepth = folder.parentId ? depths.get(folder.parentId) : undefined;
                if (parentDepth !== undefined && !depths.has(folder.id)) {
                  depths.set(folder.id, parentDepth + 1);
                  changed = true;
                }
              }
            }
            const subtreeDepth = Math.max(...depths.values());
            if (targetDepth + subtreeDepth > this.config.WORKSPACE_MAX_DEPTH) {
              throw new CodedHttpException(
                "LIMIT_EXCEEDED",
                "The restored subtree exceeds the workspace depth limit.",
                422,
              );
            }
          }
          const normalized = this.names.validate(item.name, kind);
          const model = kind === "folder" ? transaction.folder : transaction.document;
          const parentField = kind === "folder" ? "parentId" : "folderId";
          const conflict = await (model as typeof transaction.folder).findFirst({
            where: {
              workspaceId: principal.workspaceId,
              [parentField]: targetId,
              normalizedName: normalized.normalizedName,
              state: ResourceState.ACTIVE,
              id: { not: id },
            },
            select: { id: true },
          });
          let restoredName = normalized.name;
          let restoredNormalizedName = normalized.normalizedName;
          if (conflict) {
            if (input.conflictStrategy !== "KEEP_BOTH") {
              throw new CodedHttpException(
                "NAME_CONFLICT",
                "An active item with the same name exists. Choose Keep Both or another target.",
                409,
              );
            }
            ({ name: restoredName, normalizedName: restoredNormalizedName } =
              await this.availableKeepBothName(
                transaction,
                principal.workspaceId,
                kind,
                targetId,
                item.name,
              ));
          }
          const restoredAt = new Date();
          if (kind === "folder") {
            await transaction.folder.update({
              where: { id },
              data: {
                parentId: targetId,
                name: restoredName,
                normalizedName: restoredNormalizedName,
                state: ResourceState.ACTIVE,
                originalParentId: null,
                originalParentIsRoot: false,
                originalPath: null,
                deletedAt: null,
              },
            });
          } else {
            await transaction.document.update({
              where: { id },
              data: {
                folderId: targetId,
                name: restoredName,
                normalizedName: restoredNormalizedName,
                state: ResourceState.ACTIVE,
                originalFolderId: null,
                originalFolderIsRoot: false,
                originalPath: null,
                deletedAt: null,
              },
            });
          }
          await transaction.auditEvent.create({
            data: {
              actorUserId: principal.userId,
              workspaceId: principal.workspaceId,
              action: `${kind}.restore`,
              targetType: kind,
              targetId: id,
              result: "SUCCESS",
              requestId,
              metadata: {
                targetParentId: targetId,
                keepBoth: input.conflictStrategy === "KEEP_BOTH",
              },
            },
          });
          return {
            success: true,
            id,
            name: restoredName,
            parentId: targetId,
            restoredAt: restoredAt.toISOString(),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof CodedHttpException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new CodedHttpException(
          "NAME_CONFLICT",
          "An active item with the same name exists.",
          409,
        );
      }
      throw error;
    }
  }

  private async enqueueDelete(
    principal: Principal,
    kind: "folder" | "document",
    id: string,
    requestId: string,
  ): Promise<PermanentDeleteResult> {
    return this.database.client.$transaction(async (transaction) => {
      const existing = await transaction.backgroundJob.findFirst({
        where: {
          workspaceId: principal.workspaceId,
          ownerUserId: principal.userId,
          targetType: kind,
          targetId: id,
          state: {
            in: [
              BackgroundJobState.PENDING,
              BackgroundJobState.RUNNING,
              BackgroundJobState.SUCCEEDED,
            ],
          },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return { accepted: true, job: jobDto(existing) };
      const model = kind === "folder" ? transaction.folder : transaction.document;
      const item = await (model as typeof transaction.folder).findFirst({
        where: {
          id,
          workspaceId: principal.workspaceId,
          state: { in: [ResourceState.TRASHED, ResourceState.DELETING] },
        },
      });
      if (!item) this.notFound(kind === "folder" ? "Folder" : "Document");
      await (model as typeof transaction.folder).update({
        where: { id },
        data: { state: ResourceState.DELETING },
      });
      const job = await transaction.backgroundJob.create({
        data: {
          workspaceId: principal.workspaceId,
          ownerUserId: principal.userId,
          type:
            kind === "folder"
              ? BackgroundJobType.PERMANENT_DELETE_FOLDER
              : BackgroundJobType.PERMANENT_DELETE_DOCUMENT,
          targetType: kind,
          targetId: id,
        },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: principal.userId,
          workspaceId: principal.workspaceId,
          action: `${kind}.delete.request`,
          targetType: kind,
          targetId: id,
          result: "SUCCESS",
          requestId,
          metadata: { jobId: job.id, backupRetentionCaveat: true },
        },
      });
      return { accepted: true, job: jobDto(job) };
    });
  }

  private async availableKeepBothName(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    kind: "folder" | "document",
    parentId: string | null,
    originalName: string,
  ) {
    const extension = kind === "document" ? ".md" : "";
    const stem = extension ? originalName.slice(0, -extension.length) : originalName;
    for (let index = 2; index <= 10_000; index += 1) {
      const candidate = this.names.validate(`${stem} (${index})${extension}`, kind);
      const model = kind === "folder" ? transaction.folder : transaction.document;
      const parentField = kind === "folder" ? "parentId" : "folderId";
      const conflict = await (model as typeof transaction.folder).findFirst({
        where: {
          workspaceId,
          [parentField]: parentId,
          normalizedName: candidate.normalizedName,
          state: ResourceState.ACTIVE,
        },
        select: { id: true },
      });
      if (!conflict) return candidate;
    }
    throw new CodedHttpException("LIMIT_EXCEEDED", "No safe Keep Both name is available.", 422);
  }

  private trashItem(
    item: {
      id: string;
      name: string;
      state: ResourceState;
      deletedAt: Date | null;
      originalPath: string | null;
      originalParentId?: string | null;
      originalFolderId?: string | null;
    },
    type: "FOLDER" | "DOCUMENT",
  ) {
    const deletedAt = item.deletedAt ?? new Date(0);
    return {
      id: item.id,
      type,
      name: item.name,
      originalParentId:
        "originalParentId" in item
          ? (item.originalParentId ?? null)
          : (item.originalFolderId ?? null),
      originalPath: item.originalPath ?? `/${item.name}`,
      deletedAt: deletedAt.toISOString(),
      permanentlyDeletableAt: new Date(
        deletedAt.getTime() + this.config.TRASH_RETENTION_DAYS * 86_400_000,
      ).toISOString(),
      state: item.state === ResourceState.DELETING ? ("DELETING" as const) : ("TRASHED" as const),
    };
  }

  private targetRequired(): never {
    throw new CodedHttpException(
      "RESTORE_TARGET_REQUIRED",
      "The original parent is unavailable. Choose an active restore target.",
      409,
    );
  }

  private decodeTrashCursor(cursor: string): {
    id: string;
    type: "FOLDER" | "DOCUMENT";
    deletedAt: string;
  } {
    try {
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<
        string,
        unknown
      >;
      if (
        typeof value.id !== "string" ||
        (value.type !== "FOLDER" && value.type !== "DOCUMENT") ||
        typeof value.deletedAt !== "string"
      ) {
        throw new Error("invalid cursor");
      }
      return { id: value.id, type: value.type, deletedAt: value.deletedAt };
    } catch {
      throw new CodedHttpException("VALIDATION_FAILED", "The Trash cursor is invalid.", 400);
    }
  }

  private notFound(resource: string): never {
    throw new CodedHttpException("NOT_FOUND", `${resource} not found.`, 404);
  }
}

export function jobDto(job: {
  id: string;
  type: "PERMANENT_DELETE_FOLDER" | "PERMANENT_DELETE_DOCUMENT" | "IMPORT" | "EXPORT";
  state:
    | "PENDING"
    | "RUNNING"
    | "SUCCEEDED"
    | "SUCCEEDED_WITH_ISSUES"
    | "FAILED"
    | "CANCELLED"
    | "INTERRUPTED";
  targetType: string;
  targetId: string;
  progress: number;
  errorCode: string | null;
  checkpoint?: unknown;
  result?: unknown;
  parentJobId?: string | null;
  cancellationRequested?: boolean;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}) {
  const checkpoint = recordValue(job.checkpoint);
  const completed = integerValue(checkpoint.completed) ?? job.progress;
  const total = integerValue(checkpoint.total) ?? 100;
  return {
    id: job.id,
    type: job.type,
    state: job.state,
    targetType: job.targetType as "folder" | "document" | "import-plan" | "export",
    targetId: job.targetId,
    progress: job.progress,
    progressDetail: {
      completed,
      total,
      currentItem: typeof checkpoint.currentItem === "string" ? checkpoint.currentItem : null,
      phase:
        typeof checkpoint.phase === "string"
          ? checkpoint.phase
          : job.type.startsWith("PERMANENT_DELETE")
            ? "deleting"
            : "queued",
    },
    result: nullableRecord(job.result),
    errorCode: job.errorCode,
    parentJobId: job.parentJobId ?? null,
    cancellationRequested: job.cancellationRequested ?? false,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nullableRecord(value: unknown): Record<string, unknown> | null {
  return value === null || value === undefined ? null : recordValue(value);
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
