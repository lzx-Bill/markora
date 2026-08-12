import type { AcceptedJob, BackgroundJob, JobItemPage, Principal } from "@markora/contracts";
import { BackgroundJobState, BackgroundJobType, JobItemState, Prisma } from "@markora/database";
import { Inject, Injectable } from "@nestjs/common";
import { jobDto } from "../content/trash.service.js";
import { DatabaseService } from "../database/database.service.js";
import { CodedHttpException } from "../http/coded-http.exception.js";

@Injectable()
export class JobService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  public async get(principal: Principal, id: string): Promise<BackgroundJob> {
    const job = await this.ownedJob(principal, id);
    return jobDto(job);
  }

  public async items(principal: Principal, id: string, cursor?: string): Promise<JobItemPage> {
    await this.ownedJob(principal, id);
    const offset = cursor ? decodeOffset(cursor) : 0;
    const items = await this.database.client.jobItem.findMany({
      where: { jobId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: offset,
      take: 101,
    });
    return {
      data: items.slice(0, 100).map((item) => ({
        id: item.id,
        sourceKey: item.sourceKey,
        state: item.state,
        result: nullableRecord(item.result),
        errorCode: item.errorCode,
        attempts: item.attempts,
        updatedAt: item.updatedAt.toISOString(),
      })),
      nextCursor:
        items.length > 100 ? Buffer.from(String(offset + 100), "utf8").toString("base64url") : null,
    };
  }

  public async cancel(principal: Principal, id: string, requestId: string): Promise<AcceptedJob> {
    return this.database.client.$transaction(
      async (transaction) => {
        const job = await transaction.backgroundJob.findFirst({
          where: { id, workspaceId: principal.workspaceId, ownerUserId: principal.userId },
        });
        if (
          !job ||
          (job.type !== BackgroundJobType.IMPORT && job.type !== BackgroundJobType.EXPORT)
        ) {
          throw new CodedHttpException("NOT_FOUND", "Cancellable job not found.", 404);
        }
        if (job.state !== BackgroundJobState.PENDING && job.state !== BackgroundJobState.RUNNING) {
          throw new CodedHttpException(
            "JOB_NOT_CANCELLABLE",
            "This job can no longer be cancelled.",
            409,
          );
        }
        const immediate = job.state === BackgroundJobState.PENDING;
        const updated = await transaction.backgroundJob.update({
          where: { id: job.id },
          data: immediate
            ? {
                state: BackgroundJobState.CANCELLED,
                cancellationRequested: true,
                completedAt: new Date(),
                checkpoint: mergeRecord(job.checkpoint, {
                  phase: "cancelled",
                  currentItem: null,
                }) as Prisma.InputJsonValue,
              }
            : { cancellationRequested: true },
        });
        if (immediate) {
          await transaction.jobItem.updateMany({
            where: { jobId: job.id, state: JobItemState.PENDING },
            data: { state: JobItemState.CANCELLED, errorCode: "JOB_CANCELLED" },
          });
        }
        await transaction.auditEvent.create({
          data: {
            actorUserId: principal.userId,
            workspaceId: principal.workspaceId,
            action: "job.cancel",
            targetType: "job",
            targetId: job.id,
            result: "SUCCESS",
            requestId,
            metadata: { immediate },
          },
        });
        return { accepted: true, job: jobDto(updated) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async retryFailed(
    principal: Principal,
    id: string,
    requestId: string,
  ): Promise<AcceptedJob> {
    return this.database.client.$transaction(
      async (transaction) => {
        const source = await transaction.backgroundJob.findFirst({
          where: {
            id,
            workspaceId: principal.workspaceId,
            ownerUserId: principal.userId,
            type: BackgroundJobType.IMPORT,
          },
        });
        if (
          !source ||
          (source.state !== BackgroundJobState.FAILED &&
            source.state !== BackgroundJobState.SUCCEEDED_WITH_ISSUES)
        ) {
          throw new CodedHttpException(
            "JOB_NOT_RETRYABLE",
            "This job has no retryable failed items.",
            409,
          );
        }
        const activeChild = await transaction.backgroundJob.findFirst({
          where: {
            parentJobId: source.id,
            state: { in: [BackgroundJobState.PENDING, BackgroundJobState.RUNNING] },
          },
          orderBy: { createdAt: "desc" },
        });
        if (activeChild) return { accepted: true, job: jobDto(activeChild) };
        const completedRetries = await transaction.jobItem.findMany({
          where: {
            job: { parentJobId: source.id },
            state: { in: [JobItemState.SUCCEEDED, JobItemState.SKIPPED] },
          },
          select: { sourceKey: true },
        });
        const alreadyCompleted = new Set(completedRetries.map(({ sourceKey }) => sourceKey));
        const failed = (
          await transaction.jobItem.findMany({
            where: { jobId: source.id, state: JobItemState.FAILED },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          })
        ).filter(({ sourceKey }) => !alreadyCompleted.has(sourceKey));
        if (failed.length === 0) {
          throw new CodedHttpException(
            "JOB_NOT_RETRYABLE",
            "This job has no retryable failed items.",
            409,
          );
        }
        const retry = await transaction.backgroundJob.create({
          data: {
            workspaceId: source.workspaceId,
            ownerUserId: source.ownerUserId,
            type: BackgroundJobType.IMPORT,
            targetType: source.targetType,
            targetId: source.targetId,
            parentJobId: source.id,
            payload: mergeRecord(source.payload, { retryOf: source.id }) as Prisma.InputJsonValue,
            checkpoint: { completed: 0, total: failed.length, currentItem: null, phase: "queued" },
            items: {
              create: failed.map((item) => ({
                sourceKey: item.sourceKey,
                payload: item.payload as Prisma.InputJsonValue,
              })),
            },
          },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: principal.userId,
            workspaceId: principal.workspaceId,
            action: "job.retry-failed",
            targetType: "job",
            targetId: retry.id,
            result: "SUCCESS",
            requestId,
            metadata: { parentJobId: source.id, failedItems: failed.length },
          },
        });
        return { accepted: true, job: jobDto(retry) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async ownedJob(principal: Principal, id: string) {
    const job = await this.database.client.backgroundJob.findFirst({
      where: { id, workspaceId: principal.workspaceId, ownerUserId: principal.userId },
    });
    if (!job) throw new CodedHttpException("NOT_FOUND", "Job not found.", 404);
    return job;
  }
}

function decodeOffset(cursor: string): number {
  const value = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new CodedHttpException("VALIDATION_FAILED", "The job item cursor is invalid.", 400);
  }
  return value;
}

function nullableRecord(value: unknown): Record<string, unknown> | null {
  return value === null || value === undefined ? null : mergeRecord(value, {});
}

function mergeRecord(value: unknown, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}),
    ...extra,
  };
}
