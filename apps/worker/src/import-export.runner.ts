import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { loadServerConfig } from "@markora/config";
import {
  BackgroundJobState,
  BackgroundJobType,
  DocumentVersionReason,
  JobItemState,
  Prisma,
  ResourceState,
} from "@markora/database";
import { NamingPolicy } from "@markora/domain";
import { privatePath, writeMarkdownZip } from "@markora/portability";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";

class ItemFailure extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class JobCancelled extends Error {}
class JobLeaseLost extends Error {}

@Injectable()
export class ImportExportRunner {
  private readonly config = loadServerConfig(process.env);
  private readonly workerId = `portability-${process.pid}-${randomUUID()}`;
  private readonly logger = new Logger(ImportExportRunner.name);
  private readonly names = new NamingPolicy({
    maxCodePoints: this.config.WORKSPACE_NAME_MAX_CODE_POINTS,
  });

  public constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  public async runOnce(): Promise<boolean> {
    const job = await this.claim();
    if (!job) return false;
    try {
      if (!(await this.authorized(job.workspaceId, job.ownerUserId))) {
        await this.failJob(job.id, "JOB_AUTHORIZATION_REVOKED");
        return true;
      }
      if (job.cancellationRequested) {
        await this.cancelJob(job.id);
        return true;
      }
      if (job.type === BackgroundJobType.IMPORT) await this.runImport(job.id);
      else await this.runExport(job.id);
    } catch (error) {
      if (error instanceof JobCancelled) {
        await this.cancelJob(job.id);
        return true;
      }
      if (error instanceof JobLeaseLost) return true;
      this.logger.error(`Portability job ${job.id} failed`, error);
      await this.failJob(job.id, "PORTABILITY_JOB_FAILED");
    }
    return true;
  }

  public async runMaintenanceOnce(): Promise<void> {
    await this.cleanupExpiredArtifacts();
    await this.cleanupExpiredUploads();
    await this.cleanupOrphans();
  }

  private async claim() {
    const now = new Date();
    const candidate = await this.database.client.backgroundJob.findFirst({
      where: {
        type: { in: [BackgroundJobType.IMPORT, BackgroundJobType.EXPORT] },
        runAfter: { lte: now },
        OR: [
          { state: BackgroundJobState.PENDING },
          { state: BackgroundJobState.RUNNING, leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!candidate) return null;
    return this.database.client.$transaction(async (transaction) => {
      const leaseExpiresAt = new Date(now.getTime() + this.config.JOB_LEASE_SECONDS * 1000);
      const claimed = await transaction.backgroundJob.updateMany({
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
      if (candidate.state === BackgroundJobState.RUNNING) {
        await transaction.jobItem.updateMany({
          where: { jobId: candidate.id, state: JobItemState.RUNNING },
          data: { state: JobItemState.PENDING, errorCode: null },
        });
      }
      return transaction.backgroundJob.findUniqueOrThrow({ where: { id: candidate.id } });
    });
  }

  private async runImport(jobId: string): Promise<void> {
    const job = await this.database.client.backgroundJob.findUniqueOrThrow({
      where: { id: jobId },
      include: {
        items: { where: { state: JobItemState.PENDING }, orderBy: { createdAt: "asc" }, take: 1 },
      },
    });
    if (job.cancellationRequested) {
      await this.cancelJob(job.id);
      return;
    }
    const item = job.items[0];
    if (!item) {
      await this.finishImport(job.id);
      return;
    }
    const claimed = await this.database.client.jobItem.updateMany({
      where: { id: item.id, jobId: job.id, state: JobItemState.PENDING },
      data: { state: JobItemState.RUNNING, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      await this.release(job.id);
      return;
    }
    const [totalItems, completedItems] = await Promise.all([
      this.database.client.jobItem.count({ where: { jobId: job.id } }),
      this.database.client.jobItem.count({
        where: {
          jobId: job.id,
          state: { notIn: [JobItemState.PENDING, JobItemState.RUNNING] },
        },
      }),
    ]);
    await this.database.client.backgroundJob.updateMany({
      where: { id: job.id, leaseOwner: this.workerId, state: BackgroundJobState.RUNNING },
      data: {
        checkpoint: {
          completed: completedItems,
          total: totalItems,
          currentItem: item.sourceKey,
          phase: "importing",
        },
      },
    });
    try {
      const payload = importPayload(item.payload);
      const plan = await this.database.client.importPlan.findFirst({
        where: { id: job.targetId, workspaceId: job.workspaceId, ownerUserId: job.ownerUserId },
        include: { upload: true },
      });
      if (!plan) throw new ItemFailure("IMPORT_PLAN_MISSING", "Import plan is unavailable.");
      const sourcePath = containedPath(plan.upload.tempPath, payload.storageRelativePath);
      const bytes = await readFile(sourcePath);
      if (
        bytes.length !== payload.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== payload.sha256
      ) {
        throw new ItemFailure("IMPORT_SOURCE_CHANGED", "Source bytes changed after preview.");
      }
      let markdown: string;
      try {
        markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new ItemFailure("INVALID_ENCODING", "Markdown is not valid UTF-8.");
      }
      await this.applyImport(job, item.id, payload, markdown);
    } catch (error) {
      if (error instanceof JobCancelled) {
        await this.cancelJob(job.id);
        return;
      }
      if (error instanceof JobLeaseLost) return;
      const failure = itemFailure(error);
      await this.database.client.jobItem.updateMany({
        where: { id: item.id, jobId: job.id, state: JobItemState.RUNNING },
        data: {
          state: JobItemState.FAILED,
          errorCode: failure.code,
          result: { reason: failure.message },
        },
      });
    }
    await this.updateImportProgress(job.id);
  }

  private async applyImport(
    job: { id: string; workspaceId: string; ownerUserId: string; targetId: string },
    itemId: string,
    payload: ReturnType<typeof importPayload>,
    markdown: string,
  ): Promise<void> {
    await this.database.client.$transaction(
      async (transaction) => {
        const current = await transaction.jobItem.findFirst({
          where: { id: itemId, jobId: job.id, state: JobItemState.RUNNING },
        });
        if (!current) return;
        const activeJob = await transaction.backgroundJob.findFirst({
          where: {
            id: job.id,
            workspaceId: job.workspaceId,
            ownerUserId: job.ownerUserId,
            state: BackgroundJobState.RUNNING,
            leaseOwner: this.workerId,
            cancellationRequested: false,
            workspace: { ownerUserId: job.ownerUserId, owner: { status: "ACTIVE" } },
          },
          select: { id: true },
        });
        if (!activeJob) {
          const cancelled = await transaction.backgroundJob.findFirst({
            where: { id: job.id, cancellationRequested: true },
            select: { id: true },
          });
          if (cancelled) throw new JobCancelled();
          if (
            await transaction.workspace.findFirst({
              where: {
                id: job.workspaceId,
                ownerUserId: job.ownerUserId,
                owner: { status: "ACTIVE" },
              },
              select: { id: true },
            })
          ) {
            throw new JobLeaseLost();
          }
          throw new ItemFailure("JOB_AUTHORIZATION_REVOKED", "Job authorization was revoked.");
        }
        const plan = await transaction.importPlan.findFirst({
          where: { id: job.targetId, workspaceId: job.workspaceId, ownerUserId: job.ownerUserId },
        });
        if (!plan) throw new ItemFailure("IMPORT_PLAN_MISSING", "Import plan is unavailable.");
        let parentId = plan.targetFolderId;
        if (parentId) {
          if (!(await this.isReachableFolder(transaction, job.workspaceId, parentId)))
            throw new ItemFailure("IMPORT_TARGET_MISSING", "Import target folder is unavailable.");
        }
        for (const directoryName of payload.directoryNames) {
          const validated = this.names.validate(directoryName, "folder");
          let folder = await transaction.folder.findFirst({
            where: {
              workspaceId: job.workspaceId,
              parentId,
              normalizedName: validated.normalizedName,
              state: ResourceState.ACTIVE,
            },
          });
          folder ??= await transaction.folder.create({
            data: {
              workspaceId: job.workspaceId,
              parentId,
              name: validated.name,
              normalizedName: validated.normalizedName,
            },
          });
          parentId = folder.id;
        }
        const validated = this.names.validate(payload.documentName, "document");
        const existing = await transaction.document.findFirst({
          where: {
            workspaceId: job.workspaceId,
            folderId: parentId,
            normalizedName: validated.normalizedName,
            state: ResourceState.ACTIVE,
          },
        });
        if (existing && payload.strategy === "SKIP") {
          await transaction.jobItem.update({
            where: { id: itemId },
            data: {
              state: JobItemState.SKIPPED,
              result: { reason: "NAME_CONFLICT", targetPath: payload.targetPath },
            },
          });
          return;
        }
        if (existing && payload.strategy === "REPLACE") {
          const latest = await transaction.documentVersion.aggregate({
            where: { documentId: existing.id },
            _max: { versionNo: true },
          });
          await transaction.documentVersion.create({
            data: {
              documentId: existing.id,
              workspaceId: job.workspaceId,
              versionNo: (latest._max.versionNo ?? 0) + 1,
              markdown: existing.markdown,
              documentName: existing.name,
              reason: DocumentVersionReason.IMPORT_REPLACE,
              sourceRevision: existing.revision,
              actorId: job.ownerUserId,
            },
          });
          const updated = await transaction.document.update({
            where: { id: existing.id },
            data: { markdown, revision: { increment: 1 } },
          });
          await transaction.jobItem.update({
            where: { id: itemId },
            data: {
              state: JobItemState.SUCCEEDED,
              result: { action: "REPLACED", documentId: updated.id, revision: updated.revision },
            },
          });
          return;
        }
        const name = existing
          ? await this.availableName(transaction, job.workspaceId, parentId, validated.name)
          : validated;
        const created = await transaction.document.create({
          data: {
            workspaceId: job.workspaceId,
            folderId: parentId,
            name: name.name,
            normalizedName: name.normalizedName,
            markdown,
          },
        });
        await transaction.jobItem.update({
          where: { id: itemId },
          data: {
            state: JobItemState.SUCCEEDED,
            result: {
              action: existing ? "KEPT_BOTH" : "CREATED",
              documentId: created.id,
              name: created.name,
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async availableName(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    folderId: string | null,
    originalName: string,
  ) {
    const stem = originalName.slice(0, -3);
    for (let suffix = 2; suffix <= 10_000; suffix += 1) {
      const candidate = this.names.validate(`${stem} (${suffix}).md`, "document");
      const conflict = await transaction.document.findFirst({
        where: {
          workspaceId,
          folderId,
          normalizedName: candidate.normalizedName,
          state: ResourceState.ACTIVE,
        },
        select: { id: true },
      });
      if (!conflict) return candidate;
    }
    throw new ItemFailure("LIMIT_EXCEEDED", "No collision-free Keep Both name is available.");
  }

  private async isReachableFolder(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    folderId: string,
  ): Promise<boolean> {
    let cursor: string | null = folderId;
    const visited = new Set<string>();
    while (cursor) {
      if (visited.has(cursor)) return false;
      visited.add(cursor);
      const folder: { parentId: string | null } | null = await transaction.folder.findFirst({
        where: { id: cursor, workspaceId, state: ResourceState.ACTIVE },
        select: { parentId: true },
      });
      if (!folder) return false;
      cursor = folder.parentId;
    }
    return true;
  }

  private async updateImportProgress(jobId: string): Promise<void> {
    const counts = await this.database.client.jobItem.groupBy({
      by: ["state"],
      where: { jobId },
      _count: { _all: true },
    });
    const count = new Map(counts.map((entry) => [entry.state, entry._count._all]));
    const total = counts.reduce((sum, entry) => sum + entry._count._all, 0);
    const pending = (count.get(JobItemState.PENDING) ?? 0) + (count.get(JobItemState.RUNNING) ?? 0);
    const completed = total - pending;
    if (pending > 0) {
      await this.database.client.backgroundJob.update({
        where: { id: jobId },
        data: {
          state: BackgroundJobState.PENDING,
          progress: Math.floor((completed * 100) / Math.max(1, total)),
          checkpoint: { completed, total, currentItem: null, phase: "importing" },
          leaseOwner: null,
          leaseExpiresAt: null,
          runAfter: new Date(),
        },
      });
      return;
    }
    await this.finishImport(jobId, count, total);
  }

  private async finishImport(
    jobId: string,
    knownCounts?: Map<JobItemState, number>,
    knownTotal?: number,
  ): Promise<void> {
    let counts = knownCounts;
    let total = knownTotal;
    if (!counts || total === undefined) {
      const grouped = await this.database.client.jobItem.groupBy({
        by: ["state"],
        where: { jobId },
        _count: { _all: true },
      });
      counts = new Map(grouped.map((entry) => [entry.state, entry._count._all]));
      total = grouped.reduce((sum, entry) => sum + entry._count._all, 0);
    }
    const failed = counts.get(JobItemState.FAILED) ?? 0;
    const skipped = counts.get(JobItemState.SKIPPED) ?? 0;
    const succeeded = counts.get(JobItemState.SUCCEEDED) ?? 0;
    await this.database.client.backgroundJob.update({
      where: { id: jobId },
      data: {
        state: failed > 0 ? BackgroundJobState.SUCCEEDED_WITH_ISSUES : BackgroundJobState.SUCCEEDED,
        progress: 100,
        checkpoint: { completed: total, total, currentItem: null, phase: "complete" },
        result: { total, succeeded, skipped, failed },
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  private async runExport(jobId: string): Promise<void> {
    const job = await this.database.client.backgroundJob.findUniqueOrThrow({
      where: { id: jobId },
      include: {
        exportManifest: {
          include: { items: { orderBy: [{ archivePath: "asc" }, { id: "asc" }] } },
        },
      },
    });
    if (!job.exportManifest) throw new Error("Export manifest is missing.");
    const outputDirectory = privatePath(
      this.config.TEMP_ROOT,
      "exports",
      `job_${job.id.replaceAll("-", "")}`,
    );
    const temporary = resolve(outputDirectory, `${randomUUID()}.part`);
    const finalPath = resolve(outputDirectory, "export.zip");
    const report = exportReport(job.exportManifest.report);
    try {
      await rm(finalPath, { force: true });
      const byteSize = await writeMarkdownZip(
        job.exportManifest.items.map((item) => ({
          archivePath: item.archivePath,
          markdown: item.markdown,
        })),
        temporary,
        report,
      );
      await rename(temporary, finalPath);
      const expiresAt = payloadExpiry(job.payload, this.config.EXPORT_DOWNLOAD_TTL_MINUTES);
      await this.database.client.$transaction(async (transaction) => {
        const authorized = await transaction.backgroundJob.findFirst({
          where: {
            id: job.id,
            state: BackgroundJobState.RUNNING,
            leaseOwner: this.workerId,
            cancellationRequested: false,
            workspace: { ownerUserId: job.ownerUserId, owner: { status: "ACTIVE" } },
          },
        });
        if (!authorized) {
          const cancelled = await transaction.backgroundJob.findFirst({
            where: { id: job.id, cancellationRequested: true },
            select: { id: true },
          });
          if (cancelled) throw new JobCancelled();
          if (
            await transaction.workspace.findFirst({
              where: {
                id: job.workspaceId,
                ownerUserId: job.ownerUserId,
                owner: { status: "ACTIVE" },
              },
              select: { id: true },
            })
          ) {
            throw new JobLeaseLost();
          }
          throw new Error("Export authorization was revoked.");
        }
        await transaction.exportArtifact.upsert({
          where: { jobId: job.id },
          create: { jobId: job.id, filePath: finalPath, byteSize, expiresAt },
          update: { filePath: finalPath, byteSize, expiresAt },
        });
        await transaction.jobItem.updateMany({
          where: { jobId: job.id, state: { in: [JobItemState.PENDING, JobItemState.RUNNING] } },
          data: { state: JobItemState.SUCCEEDED },
        });
        await transaction.backgroundJob.update({
          where: { id: job.id },
          data: {
            state: BackgroundJobState.SUCCEEDED,
            progress: 100,
            checkpoint: {
              completed: job.exportManifest?.items.length ?? 0,
              total: job.exportManifest?.items.length ?? 0,
              currentItem: null,
              phase: "complete",
            },
            result: { documents: job.exportManifest?.items.length ?? 0, byteSize },
            completedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
      });
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      await rm(finalPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private authorized(workspaceId: string, ownerUserId: string) {
    return this.database.client.workspace.findFirst({
      where: { id: workspaceId, ownerUserId, owner: { status: "ACTIVE" } },
      select: { id: true },
    });
  }

  private async cancelJob(jobId: string): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      await transaction.jobItem.updateMany({
        where: { jobId, state: { in: [JobItemState.PENDING, JobItemState.RUNNING] } },
        data: { state: JobItemState.CANCELLED, errorCode: "JOB_CANCELLED" },
      });
      const total = await transaction.jobItem.count({ where: { jobId } });
      const completed = await transaction.jobItem.count({
        where: { jobId, state: { notIn: [JobItemState.PENDING, JobItemState.RUNNING] } },
      });
      await transaction.backgroundJob.update({
        where: { id: jobId },
        data: {
          state: BackgroundJobState.CANCELLED,
          progress: Math.floor((completed * 100) / Math.max(1, total)),
          checkpoint: { completed, total, currentItem: null, phase: "cancelled" },
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    });
  }

  private async release(jobId: string): Promise<void> {
    await this.database.client.backgroundJob.updateMany({
      where: { id: jobId, leaseOwner: this.workerId },
      data: { state: BackgroundJobState.PENDING, leaseOwner: null, leaseExpiresAt: null },
    });
  }

  private async failJob(jobId: string, errorCode: string): Promise<void> {
    await this.database.client.backgroundJob.updateMany({
      where: { id: jobId, state: { in: [BackgroundJobState.PENDING, BackgroundJobState.RUNNING] } },
      data: {
        state: BackgroundJobState.FAILED,
        errorCode,
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  private async cleanupExpiredArtifacts(): Promise<void> {
    const artifacts = await this.database.client.exportArtifact.findMany({
      where: { expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: "asc" },
      take: this.config.JOB_ITEM_BATCH_SIZE,
    });
    const exportRoot = resolve(this.config.TEMP_ROOT, "exports");
    for (const artifact of artifacts) {
      const path = resolve(artifact.filePath);
      if (path.startsWith(`${exportRoot}${sep}`)) {
        await rm(dirname(path), { recursive: true, force: true }).catch(() => undefined);
      }
      await this.database.client.exportArtifact.deleteMany({
        where: { id: artifact.id, expiresAt: { lte: new Date() } },
      });
    }
  }

  private async cleanupExpiredUploads(): Promise<void> {
    const uploads = await this.database.client.importUpload.findMany({
      where: { expiresAt: { lte: new Date() } },
      include: { plans: { select: { id: true } } },
      orderBy: { expiresAt: "asc" },
      take: this.config.JOB_ITEM_BATCH_SIZE,
    });
    const importRoot = resolve(this.config.TEMP_ROOT, "imports");
    for (const upload of uploads) {
      const planIds = upload.plans.map(({ id }) => id);
      const active = planIds.length
        ? await this.database.client.backgroundJob.findFirst({
            where: {
              targetId: { in: planIds },
              state: { in: [BackgroundJobState.PENDING, BackgroundJobState.RUNNING] },
            },
          })
        : null;
      if (active) continue;
      const path = resolve(upload.tempPath);
      if (path.startsWith(`${importRoot}${sep}`)) {
        await rm(path, { recursive: true, force: true }).catch(() => undefined);
      }
      await this.database.client.importUpload.deleteMany({
        where: { id: upload.id, expiresAt: { lte: new Date() } },
      });
    }
  }

  private async cleanupOrphans(): Promise<void> {
    const cutoff = Date.now() - this.config.TEMP_ORPHAN_AGE_MINUTES * 60_000;
    const importRoot = resolve(this.config.TEMP_ROOT, "imports");
    const exportRoot = resolve(this.config.TEMP_ROOT, "exports");
    const [uploads, artifacts] = await Promise.all([
      this.database.client.importUpload.findMany({ select: { tempPath: true } }),
      this.database.client.exportArtifact.findMany({ select: { filePath: true } }),
    ]);
    const referenced = new Set([
      ...uploads.map(({ tempPath }) => resolve(tempPath)),
      ...artifacts.map(({ filePath }) => dirname(resolve(filePath))),
    ]);
    await this.removeOldUnreferenced(importRoot, /^upload_[a-f0-9-]+$/iu, referenced, cutoff);
    await this.removeOldUnreferenced(exportRoot, /^job_[a-f0-9]+$/iu, referenced, cutoff);
  }

  private async removeOldUnreferenced(
    root: string,
    allowedName: RegExp,
    referenced: ReadonlySet<string>,
    cutoff: number,
  ): Promise<void> {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    let removed = 0;
    for (const entry of entries) {
      if (
        removed >= this.config.JOB_ITEM_BATCH_SIZE ||
        !entry.isDirectory() ||
        !allowedName.test(entry.name)
      ) {
        continue;
      }
      const path = resolve(root, entry.name);
      if (!path.startsWith(`${resolve(root)}${sep}`) || referenced.has(path)) continue;
      const info = await stat(path).catch(() => null);
      if (!info || info.mtimeMs > cutoff) continue;
      await rm(path, { recursive: true, force: true });
      removed += 1;
    }
  }
}

function importPayload(value: unknown) {
  const payload = record(value);
  const directoryNames = payload.directoryNames;
  if (
    typeof payload.storageRelativePath !== "string" ||
    typeof payload.sha256 !== "string" ||
    typeof payload.bytes !== "number" ||
    typeof payload.documentName !== "string" ||
    typeof payload.targetPath !== "string" ||
    !Array.isArray(directoryNames) ||
    directoryNames.some((name) => typeof name !== "string") ||
    !["KEEP_BOTH", "SKIP", "REPLACE"].includes(String(payload.strategy))
  ) {
    throw new ItemFailure("IMPORT_ITEM_INVALID", "Import item metadata is invalid.");
  }
  return {
    storageRelativePath: payload.storageRelativePath,
    sha256: payload.sha256,
    bytes: payload.bytes,
    documentName: payload.documentName,
    targetPath: payload.targetPath,
    directoryNames: directoryNames as string[],
    strategy: payload.strategy as "KEEP_BOTH" | "SKIP" | "REPLACE",
  };
}

function containedPath(root: string, child: string): string {
  const resolvedRoot = resolve(root);
  const path = resolve(resolvedRoot, child);
  if (!path.startsWith(`${resolvedRoot}${sep}`)) {
    throw new ItemFailure("UNSAFE_ARCHIVE", "Import source path escaped temporary storage.");
  }
  return path;
}

function itemFailure(error: unknown): ItemFailure {
  if (error instanceof ItemFailure) return error;
  if (error instanceof Error && error.name === "InvalidNameError") {
    return new ItemFailure("INVALID_NAME", "Import item has an invalid workspace name.");
  }
  return new ItemFailure("IMPORT_ITEM_FAILED", "Import item could not be applied.");
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function payloadExpiry(payload: unknown, fallbackMinutes: number): Date {
  const value = record(payload).downloadExpiresAt;
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value)
    : new Date(Date.now() + fallbackMinutes * 60_000);
}

function exportReport(value: unknown): string | undefined {
  const mappings = record(value).mappings;
  if (!Array.isArray(mappings) || mappings.length === 0) return undefined;
  const lines = mappings.flatMap((entry) => {
    const mapping = record(entry);
    return typeof mapping.from === "string" && typeof mapping.to === "string"
      ? [`${mapping.from} -> ${mapping.to}`]
      : [];
  });
  return lines.length > 0
    ? ["Markora export filename mappings", "", ...lines, ""].join("\n")
    : undefined;
}
