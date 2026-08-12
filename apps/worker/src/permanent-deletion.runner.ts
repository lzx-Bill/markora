import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@markora/config";
import { BackgroundJobState, BackgroundJobType, Prisma, ResourceState } from "@markora/database";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import { RuntimeConfigService } from "./runtime-config.service.js";

@Injectable()
export class PermanentDeletionRunner {
  private readonly config = loadServerConfig(process.env);
  private readonly workerId = `delete-${process.pid}-${randomUUID()}`;
  private readonly logger = new Logger(PermanentDeletionRunner.name);

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RuntimeConfigService) private readonly runtimeConfig: RuntimeConfigService,
  ) {}

  public async runMaintenanceOnce(): Promise<void> {
    const runtime = await this.runtimeConfig.values();
    const versionCutoff = new Date(Date.now() - runtime.versionRetentionDays * 86_400_000);
    const expiredVersions = await this.database.client.documentVersion.findMany({
      where: { reason: "AUTO_SAVE", createdAt: { lt: versionCutoff } },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: this.config.DELETE_BATCH_SIZE,
    });
    if (expiredVersions.length > 0) {
      await this.database.client.documentVersion.deleteMany({
        where: { id: { in: expiredVersions.map(({ id }) => id) }, reason: "AUTO_SAVE" },
      });
    }

    const trashCutoff = new Date(Date.now() - runtime.trashRetentionDays * 86_400_000);
    const folder = await this.database.client.folder.findFirst({
      where: {
        state: ResourceState.TRASHED,
        deletedAt: { lt: trashCutoff },
        OR: [{ parentId: null }, { parent: { state: ResourceState.ACTIVE } }],
      },
      include: { workspace: { select: { ownerUserId: true } } },
      orderBy: [{ deletedAt: "asc" }, { id: "asc" }],
    });
    if (folder) {
      await this.enqueueExpiredTrash(
        folder.workspaceId,
        folder.workspace.ownerUserId,
        "folder",
        folder.id,
        runtime.trashRetentionDays,
      );
      return;
    }
    const document = await this.database.client.document.findFirst({
      where: {
        state: ResourceState.TRASHED,
        deletedAt: { lt: trashCutoff },
        OR: [{ folderId: null }, { folder: { state: ResourceState.ACTIVE } }],
      },
      include: { workspace: { select: { ownerUserId: true } } },
      orderBy: [{ deletedAt: "asc" }, { id: "asc" }],
    });
    if (document) {
      await this.enqueueExpiredTrash(
        document.workspaceId,
        document.workspace.ownerUserId,
        "document",
        document.id,
        runtime.trashRetentionDays,
      );
    }
  }

  public async runOnce(): Promise<boolean> {
    const job = await this.claim();
    if (!job) return false;
    try {
      const authorized = await this.database.client.workspace.findFirst({
        where: { id: job.workspaceId, ownerUserId: job.ownerUserId, owner: { status: "ACTIVE" } },
        select: { id: true },
      });
      if (!authorized) {
        await this.fail(job.id, "JOB_AUTHORIZATION_REVOKED");
        return true;
      }
      const complete =
        job.type === BackgroundJobType.PERMANENT_DELETE_DOCUMENT
          ? await this.deleteDocumentBatch(job.workspaceId, job.targetId)
          : await this.deleteFolderBatch(job.workspaceId, job.targetId);
      if (complete) {
        await this.database.client.backgroundJob.update({
          where: { id: job.id },
          data: {
            state: BackgroundJobState.SUCCEEDED,
            progress: 100,
            completedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            result: { deleted: true },
          },
        });
      } else {
        await this.database.client.backgroundJob.update({
          where: { id: job.id },
          data: {
            state: BackgroundJobState.PENDING,
            progress: Math.min(95, Math.max(job.progress + 5, 5)),
            runAfter: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
      }
    } catch (error) {
      this.logger.error(`Permanent deletion job ${job.id} failed`, error);
      await this.fail(job.id, "PERMANENT_DELETE_FAILED");
    }
    return true;
  }

  private async claim() {
    const now = new Date();
    const candidate = await this.database.client.backgroundJob.findFirst({
      where: {
        type: {
          in: [
            BackgroundJobType.PERMANENT_DELETE_DOCUMENT,
            BackgroundJobType.PERMANENT_DELETE_FOLDER,
          ],
        },
        runAfter: { lte: now },
        OR: [
          { state: BackgroundJobState.PENDING },
          { state: BackgroundJobState.RUNNING, leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!candidate) return null;
    const leaseExpiresAt = new Date(now.getTime() + this.config.JOB_LEASE_SECONDS * 1000);
    const claimed = await this.database.client.backgroundJob.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { state: BackgroundJobState.PENDING },
          { state: BackgroundJobState.RUNNING, leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        state: BackgroundJobState.RUNNING,
        leaseOwner: this.workerId,
        leaseExpiresAt,
        startedAt: candidate.startedAt ?? now,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    return this.database.client.backgroundJob.findUniqueOrThrow({ where: { id: candidate.id } });
  }

  private async enqueueExpiredTrash(
    workspaceId: string,
    ownerUserId: string,
    kind: "folder" | "document",
    targetId: string,
    retentionDays: number,
  ): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      const existing = await transaction.backgroundJob.findFirst({
        where: {
          workspaceId,
          targetType: kind,
          targetId,
          state: { in: [BackgroundJobState.PENDING, BackgroundJobState.RUNNING] },
        },
        select: { id: true },
      });
      if (existing) return;
      if (kind === "folder") {
        const changed = await transaction.folder.updateMany({
          where: { id: targetId, workspaceId, state: ResourceState.TRASHED },
          data: { state: ResourceState.DELETING },
        });
        if (changed.count !== 1) return;
      } else {
        const changed = await transaction.document.updateMany({
          where: { id: targetId, workspaceId, state: ResourceState.TRASHED },
          data: { state: ResourceState.DELETING },
        });
        if (changed.count !== 1) return;
      }
      const job = await transaction.backgroundJob.create({
        data: {
          workspaceId,
          ownerUserId,
          type:
            kind === "folder"
              ? BackgroundJobType.PERMANENT_DELETE_FOLDER
              : BackgroundJobType.PERMANENT_DELETE_DOCUMENT,
          targetType: kind,
          targetId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: null,
          workspaceId,
          action: `${kind}.delete.retention`,
          targetType: kind,
          targetId,
          result: "SUCCESS",
          requestId: `worker:${job.id}`,
          metadata: { jobId: job.id, retentionDays },
        },
      });
    });
  }

  private async deleteDocumentBatch(workspaceId: string, documentId: string): Promise<boolean> {
    const target = await this.database.client.document.findFirst({
      where: { id: documentId, workspaceId, state: ResourceState.DELETING },
      select: { id: true },
    });
    if (!target) return true;
    const versionIds = await this.database.client.documentVersion.findMany({
      where: { documentId, workspaceId },
      select: { id: true },
      take: this.config.DELETE_BATCH_SIZE,
    });
    if (versionIds.length > 0) {
      await this.database.client.documentVersion.deleteMany({
        where: { id: { in: versionIds.map(({ id }) => id) }, workspaceId },
      });
      return false;
    }
    const receiptIds = await this.database.client.documentSaveReceipt.findMany({
      where: { documentId, workspaceId },
      select: { id: true },
      take: this.config.DELETE_BATCH_SIZE,
    });
    if (receiptIds.length > 0) {
      await this.database.client.documentSaveReceipt.deleteMany({
        where: { id: { in: receiptIds.map(({ id }) => id) }, workspaceId },
      });
      return false;
    }
    await this.database.client.document.deleteMany({
      where: { id: documentId, workspaceId, state: ResourceState.DELETING },
    });
    return true;
  }

  private async deleteFolderBatch(workspaceId: string, folderId: string): Promise<boolean> {
    const root = await this.database.client.folder.findFirst({
      where: { id: folderId, workspaceId, state: ResourceState.DELETING },
      select: { id: true },
    });
    if (!root) return true;
    const versionIds = await this.database.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM folders WHERE id = ${folderId}::uuid AND workspace_id = ${workspaceId}::uuid
        UNION ALL
        SELECT child.id FROM folders child JOIN subtree parent ON child.parent_id = parent.id
        WHERE child.workspace_id = ${workspaceId}::uuid
      )
      SELECT version.id FROM document_versions version
      JOIN documents document ON document.id = version.document_id
        AND document.workspace_id = version.workspace_id
      WHERE version.workspace_id = ${workspaceId}::uuid
        AND document.folder_id IN (SELECT id FROM subtree)
      ORDER BY version.id
      LIMIT ${this.config.DELETE_BATCH_SIZE}
    `);
    if (versionIds.length > 0) {
      await this.database.client.documentVersion.deleteMany({
        where: { workspaceId, id: { in: versionIds.map(({ id }) => id) } },
      });
      return false;
    }
    const receiptIds = await this.database.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM folders WHERE id = ${folderId}::uuid AND workspace_id = ${workspaceId}::uuid
        UNION ALL
        SELECT child.id FROM folders child JOIN subtree parent ON child.parent_id = parent.id
        WHERE child.workspace_id = ${workspaceId}::uuid
      )
      SELECT receipt.id FROM document_save_receipts receipt
      JOIN documents document ON document.id = receipt.document_id
        AND document.workspace_id = receipt.workspace_id
      WHERE receipt.workspace_id = ${workspaceId}::uuid
        AND document.folder_id IN (SELECT id FROM subtree)
      ORDER BY receipt.id
      LIMIT ${this.config.DELETE_BATCH_SIZE}
    `);
    if (receiptIds.length > 0) {
      await this.database.client.documentSaveReceipt.deleteMany({
        where: { workspaceId, id: { in: receiptIds.map(({ id }) => id) } },
      });
      return false;
    }
    const documentIds = await this.database.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM folders WHERE id = ${folderId}::uuid AND workspace_id = ${workspaceId}::uuid
        UNION ALL
        SELECT child.id FROM folders child JOIN subtree parent ON child.parent_id = parent.id
        WHERE child.workspace_id = ${workspaceId}::uuid
      )
      SELECT document.id FROM documents document
      WHERE document.workspace_id = ${workspaceId}::uuid
        AND document.folder_id IN (SELECT id FROM subtree)
      ORDER BY document.id
      LIMIT ${this.config.DELETE_BATCH_SIZE}
    `);
    if (documentIds.length > 0) {
      await this.database.client.document.deleteMany({
        where: { workspaceId, id: { in: documentIds.map(({ id }) => id) } },
      });
      return false;
    }
    const leafIds = await this.database.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM folders WHERE id = ${folderId}::uuid AND workspace_id = ${workspaceId}::uuid
        UNION ALL
        SELECT child.id FROM folders child JOIN subtree parent ON child.parent_id = parent.id
        WHERE child.workspace_id = ${workspaceId}::uuid
      )
      SELECT folder.id FROM folders folder
      WHERE folder.id IN (SELECT id FROM subtree)
        AND NOT EXISTS (
          SELECT 1 FROM folders child
          WHERE child.parent_id = folder.id AND child.workspace_id = ${workspaceId}::uuid
        )
      ORDER BY CASE WHEN folder.id = ${folderId}::uuid THEN 1 ELSE 0 END, folder.id
      LIMIT ${this.config.DELETE_BATCH_SIZE}
    `);
    if (leafIds.length > 0) {
      await this.database.client.folder.deleteMany({
        where: { workspaceId, id: { in: leafIds.map(({ id }) => id) } },
      });
    }
    return !(await this.database.client.folder.findFirst({
      where: { id: folderId, workspaceId },
      select: { id: true },
    }));
  }

  private async fail(jobId: string, errorCode: string): Promise<void> {
    await this.database.client.backgroundJob.update({
      where: { id: jobId },
      data: {
        state: BackgroundJobState.FAILED,
        errorCode,
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }
}
