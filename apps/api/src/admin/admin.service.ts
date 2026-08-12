import { loadServerConfig } from "@markora/config";
import type {
  AdminConfigResponse,
  AdminHealth,
  AdminJobList,
  AdminJobQuery,
  AdminOverview,
  AdminSecurity,
  AdminUserDetail,
  AdminUserList,
  AdminUserQuery,
  AuditEventList,
  AuditQuery,
  CreateAdminUserRequest,
  OperationResult,
  Principal,
  ResetAdminPasswordRequest,
  UpdateAdminConfigRequest,
  UpdateAdminUserRequest,
} from "@markora/contracts";
import { AdminConfigValuesSchema } from "@markora/contracts";
import {
  BackgroundJobState,
  BackgroundJobType,
  JobItemState,
  Prisma,
  UserRole,
  UserStatus,
} from "@markora/database";
import { canonicalizeIdentity } from "@markora/domain";
import { Inject, Injectable } from "@nestjs/common";
import { PasswordService } from "../auth/password.service.js";
import { jobDto } from "../content/trash.service.js";
import { DatabaseService } from "../database/database.service.js";
import { CodedHttpException } from "../http/coded-http.exception.js";
import {
  RuntimeConfigService,
  runtimeConfigKey,
} from "../runtime-config/runtime-config.service.js";

const processStartedAt = Date.now();

@Injectable()
export class AdminService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  public constructor(
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(RuntimeConfigService) private readonly runtimeConfig: RuntimeConfigService,
  ) {}

  public async overview(): Promise<AdminOverview> {
    const [users, activeUsers, documents, jobs, failedJobs, storage, recentIssues, worker] =
      await Promise.all([
        this.database.client.user.count(),
        this.database.client.user.count({ where: { status: UserStatus.ACTIVE } }),
        this.database.client.document.count(),
        this.database.client.backgroundJob.count(),
        this.database.client.backgroundJob.count({
          where: { state: { in: [BackgroundJobState.FAILED, BackgroundJobState.INTERRUPTED] } },
        }),
        this.database.client.$queryRaw<{ bytes: bigint }[]>`
        SELECT COALESCE(SUM(octet_length(markdown)), 0)::bigint AS bytes FROM documents
      `,
        this.database.client.backgroundJob.findMany({
          where: { state: { in: [BackgroundJobState.FAILED, BackgroundJobState.INTERRUPTED] } },
          select: { id: true, type: true, state: true, errorCode: true, updatedAt: true },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: 5,
        }),
        this.database.client.serviceHeartbeat.findUnique({ where: { service: "worker" } }),
      ]);
    const age = worker ? Date.now() - worker.seenAt.getTime() : Number.POSITIVE_INFINITY;
    return {
      counts: {
        users,
        activeUsers,
        documents,
        jobs,
        failedJobs,
        storageBytes: Number(storage[0]?.bytes ?? 0n),
      },
      components: {
        api: "HEALTHY",
        database: "HEALTHY",
        worker: !worker ? "UNKNOWN" : age <= 30_000 ? "HEALTHY" : "STALE",
      },
      recentIssues: recentIssues.map((issue) => ({
        jobId: issue.id,
        type: issue.type,
        state: issue.state as "FAILED" | "INTERRUPTED",
        errorCode: issue.errorCode,
        occurredAt: issue.updatedAt.toISOString(),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  public async users(query: AdminUserQuery): Promise<AdminUserList> {
    const offset = decodeOffset(query.cursor);
    const users = await this.database.client.user.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.role ? { role: query.role } : {}),
        ...(query.q
          ? {
              OR: [
                { username: { contains: query.q, mode: "insensitive" as const } },
                { email: { contains: query.q, mode: "insensitive" as const } },
                { displayName: { contains: query.q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: offset,
      take: 101,
    });
    return {
      data: users.slice(0, 100).map(userSummary),
      nextCursor: users.length > 100 ? encodeOffset(offset + 100) : null,
    };
  }

  public async user(id: string): Promise<AdminUserDetail> {
    const user = await this.database.client.user.findUnique({
      where: { id },
      include: {
        workspace: {
          include: {
            _count: { select: { folders: true, documents: true, backgroundJobs: true } },
          },
        },
        _count: { select: { sessions: true } },
      },
    });
    if (!user) throw new CodedHttpException("NOT_FOUND", "User not found.", 404);
    const [lastSession, storage] = await Promise.all([
      this.database.client.session.findFirst({
        where: { userId: user.id },
        orderBy: { lastActiveAt: "desc" },
        select: { lastActiveAt: true },
      }),
      user.workspace
        ? this.database.client.$queryRaw<{ bytes: bigint }[]>`
            SELECT COALESCE(SUM(octet_length(markdown)), 0)::bigint AS bytes
            FROM documents
            WHERE workspace_id = ${user.workspace.id}::uuid
          `
        : Promise.resolve([{ bytes: 0n }]),
    ]);
    return {
      ...userSummary(user),
      counts: {
        folders: user.workspace?._count.folders ?? 0,
        documents: user.workspace?._count.documents ?? 0,
        jobs: user.workspace?._count.backgroundJobs ?? 0,
        sessions: user._count.sessions,
      },
      storageBytes: Number(storage[0]?.bytes ?? 0n),
      lastActivityAt: lastSession?.lastActiveAt.toISOString() ?? null,
    };
  }

  public async createUser(principal: Principal, input: CreateAdminUserRequest, requestId: string) {
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    try {
      const user = await this.database.client.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            username: input.username,
            usernameCanonical: canonicalizeIdentity(input.username),
            email: input.email,
            emailCanonical: canonicalizeIdentity(input.email),
            displayName: input.displayName,
            passwordHash,
            role: input.role,
            mustChangePassword: true,
            workspace: { create: {} },
          },
        });
        await this.auditWrite(transaction, principal, "admin.user.create", created.id, requestId, {
          role: created.role,
        });
        return created;
      });
      return userSummary(user);
    } catch (error) {
      if (isUnique(error)) {
        throw new CodedHttpException("NAME_CONFLICT", "Username or email is already in use.", 409);
      }
      throw error;
    }
  }

  public async updateUser(
    principal: Principal,
    id: string,
    input: UpdateAdminUserRequest,
    requestId: string,
  ) {
    return this.database.client.$transaction(
      async (transaction) => {
        const current = await transaction.user.findUnique({ where: { id } });
        if (!current) throw new CodedHttpException("NOT_FOUND", "User not found.", 404);
        const removesActiveAdmin =
          current.role === UserRole.ADMIN &&
          current.status === UserStatus.ACTIVE &&
          (input.role === UserRole.USER || input.status === UserStatus.DISABLED);
        if (removesActiveAdmin) {
          const activeAdmins = await transaction.user.count({
            where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
          });
          if (activeAdmins <= 1) {
            throw new CodedHttpException(
              "RESOURCE_STATE_CONFLICT",
              "The last active administrator cannot be disabled or demoted.",
              409,
            );
          }
        }
        const updated = await transaction.user.update({
          where: { id },
          data: {
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
            ...(input.role !== undefined ? { role: input.role } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
          },
        });
        if (input.status === UserStatus.DISABLED) {
          await transaction.session.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        await this.auditWrite(transaction, principal, "admin.user.update", id, requestId, {
          fields: Object.keys(input),
        });
        return userSummary(updated);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async resetPassword(
    principal: Principal,
    id: string,
    input: ResetAdminPasswordRequest,
    requestId: string,
  ): Promise<OperationResult> {
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    await this.database.client.$transaction(async (transaction) => {
      const updated = await transaction.user.updateMany({
        where: { id },
        data: { passwordHash, mustChangePassword: true },
      });
      if (updated.count !== 1) throw new CodedHttpException("NOT_FOUND", "User not found.", 404);
      await transaction.session.updateMany({
        where: { userId: id },
        data: { revokedAt: new Date() },
      });
      await this.auditWrite(transaction, principal, "admin.user.reset-password", id, requestId, {});
    });
    return { success: true };
  }

  public async revokeSessions(
    principal: Principal,
    id: string,
    requestId: string,
  ): Promise<OperationResult> {
    await this.database.client.$transaction(async (transaction) => {
      if (!(await transaction.user.findUnique({ where: { id }, select: { id: true } }))) {
        throw new CodedHttpException("NOT_FOUND", "User not found.", 404);
      }
      const revoked = await transaction.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.auditWrite(transaction, principal, "admin.user.revoke-sessions", id, requestId, {
        revoked: revoked.count,
      });
    });
    return { success: true };
  }

  public async config(): Promise<AdminConfigResponse> {
    const row = await this.database.client.systemConfig.findUnique({
      where: { key: runtimeConfigKey },
    });
    return configResponse(row, this.runtimeConfig.defaults());
  }

  public async updateConfig(
    principal: Principal,
    input: UpdateAdminConfigRequest,
    requestId: string,
  ): Promise<AdminConfigResponse> {
    try {
      return await this.database.client.$transaction(
        async (transaction) => {
          const current = await transaction.systemConfig.findUnique({
            where: { key: runtimeConfigKey },
          });
          const version = current?.version ?? 1;
          if (version !== input.version) {
            throw new CodedHttpException(
              "CONFIG_VERSION_CONFLICT",
              "System settings changed elsewhere. Reload and review before saving.",
              409,
              { currentVersion: version },
            );
          }
          const values = AdminConfigValuesSchema.parse(input.values);
          const row = await transaction.systemConfig.upsert({
            where: { key: runtimeConfigKey },
            create: {
              key: runtimeConfigKey,
              typedValue: values,
              version: 2,
              updatedBy: principal.userId,
            },
            update: { typedValue: values, version: { increment: 1 }, updatedBy: principal.userId },
          });
          await this.auditWrite(
            transaction,
            principal,
            "admin.config.apply",
            runtimeConfigKey,
            requestId,
            {
              version: row.version,
              keys: Object.keys(values),
            },
          );
          return configResponse(row, values);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof CodedHttpException) {
        await this.database.client.auditEvent.create({
          data: {
            actorUserId: principal.userId,
            workspaceId: principal.workspaceId,
            action: "admin.config.apply",
            targetType: "system-config",
            targetId: runtimeConfigKey,
            result: "FAILURE",
            requestId,
            metadata: { code: error.code },
          },
        });
      }
      throw error;
    }
  }

  public security(): AdminSecurity {
    const config = loadServerConfig(process.env);
    return {
      immutable: {
        sanitizerRequired: true,
        scriptsBlocked: true,
        unsafeUrlsBlocked: true,
        localFileUrlsBlocked: true,
        archiveTraversalBlocked: true,
      },
      effective: {
        loginWindowSeconds: config.LOGIN_WINDOW_SECONDS,
        loginMaxAttempts: config.LOGIN_MAX_ATTEMPTS,
        passwordHash: "ARGON2ID",
        sessionCookies: "HTTP_ONLY_SAME_SITE_STRICT",
      },
    };
  }

  public async jobs(query: AdminJobQuery): Promise<AdminJobList> {
    const offset = decodeOffset(query.cursor);
    const jobs = await this.database.client.backgroundJob.findMany({
      where: {
        ...(query.state ? { state: query.state } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
      },
      include: { owner: { select: { id: true, displayName: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: offset,
      take: 101,
    });
    return {
      data: jobs.slice(0, 100).map((job) => ({
        ...jobDto(job),
        owner: job.owner,
        workspaceId: job.workspaceId,
      })),
      nextCursor: jobs.length > 100 ? encodeOffset(offset + 100) : null,
    };
  }

  public async cancelJob(principal: Principal, id: string, requestId: string) {
    return this.database.client.$transaction(async (transaction) => {
      const job = await transaction.backgroundJob.findUnique({ where: { id } });
      if (!job) throw new CodedHttpException("NOT_FOUND", "Job not found.", 404);
      if (job.state !== BackgroundJobState.PENDING && job.state !== BackgroundJobState.RUNNING) {
        throw new CodedHttpException("JOB_NOT_CANCELLABLE", "This job cannot be cancelled.", 409);
      }
      const immediate = job.state === BackgroundJobState.PENDING;
      const updated = await transaction.backgroundJob.update({
        where: { id },
        data: immediate
          ? {
              state: BackgroundJobState.CANCELLED,
              cancellationRequested: true,
              completedAt: new Date(),
            }
          : { cancellationRequested: true },
      });
      if (immediate)
        await transaction.jobItem.updateMany({
          where: { jobId: id, state: JobItemState.PENDING },
          data: { state: JobItemState.CANCELLED, errorCode: "JOB_CANCELLED" },
        });
      await this.auditWrite(transaction, principal, "admin.job.cancel", id, requestId, {
        immediate,
      });
      return { accepted: true as const, job: jobDto(updated) };
    });
  }

  public async retryJob(principal: Principal, id: string, requestId: string) {
    return this.database.client.$transaction(async (transaction) => {
      const source = await transaction.backgroundJob.findUnique({
        where: { id },
        include: { items: true, exportManifest: { include: { items: true } } },
      });
      if (!source) throw new CodedHttpException("NOT_FOUND", "Job not found.", 404);
      if (
        source.state !== BackgroundJobState.FAILED &&
        source.state !== BackgroundJobState.INTERRUPTED &&
        source.state !== BackgroundJobState.SUCCEEDED_WITH_ISSUES
      ) {
        throw new CodedHttpException("JOB_NOT_RETRYABLE", "This job cannot be retried.", 409);
      }
      const activeChild = await transaction.backgroundJob.findFirst({
        where: {
          parentJobId: source.id,
          state: { in: [BackgroundJobState.PENDING, BackgroundJobState.RUNNING] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (activeChild) return { accepted: true as const, job: jobDto(activeChild) };
      const completedRetries =
        source.type === BackgroundJobType.IMPORT
          ? await transaction.jobItem.findMany({
              where: {
                job: { parentJobId: source.id },
                state: { in: [JobItemState.SUCCEEDED, JobItemState.SKIPPED] },
              },
              select: { sourceKey: true },
            })
          : [];
      const alreadyCompleted = new Set(completedRetries.map(({ sourceKey }) => sourceKey));
      const items =
        source.type === BackgroundJobType.IMPORT
          ? source.items.filter(
              (item) => item.state === JobItemState.FAILED && !alreadyCompleted.has(item.sourceKey),
            )
          : source.items;
      if (source.type === BackgroundJobType.IMPORT && items.length === 0)
        throw new CodedHttpException("JOB_NOT_RETRYABLE", "This job has no failed items.", 409);
      if (source.type === BackgroundJobType.EXPORT && !source.exportManifest)
        throw new CodedHttpException(
          "JOB_NOT_RETRYABLE",
          "This export no longer has a retryable snapshot.",
          409,
        );
      const retry = await transaction.backgroundJob.create({
        data: {
          workspaceId: source.workspaceId,
          ownerUserId: source.ownerUserId,
          type: source.type,
          targetType: source.targetType,
          targetId: source.targetId,
          parentJobId: source.id,
          payload: withJsonFields(source.payload, { retryOf: source.id }) as Prisma.InputJsonValue,
          checkpoint: { completed: 0, total: items.length, currentItem: null, phase: "queued" },
          ...(source.type === BackgroundJobType.EXPORT && source.exportManifest
            ? {
                exportManifest: {
                  create: {
                    scope: source.exportManifest.scope,
                    report: source.exportManifest.report as Prisma.InputJsonValue,
                    items: {
                      create: source.exportManifest.items.map((item) => ({
                        sourceDocumentId: item.sourceDocumentId,
                        displayPath: item.displayPath,
                        archivePath: item.archivePath,
                        markdown: item.markdown,
                        sourceRevision: item.sourceRevision,
                        normalized: item.normalized,
                      })),
                    },
                  },
                },
              }
            : {}),
          items: {
            create: items.map((item) => ({
              sourceKey: item.sourceKey,
              payload: item.payload as Prisma.InputJsonValue,
            })),
          },
        },
      });
      await this.auditWrite(transaction, principal, "admin.job.retry", retry.id, requestId, {
        sourceJobId: source.id,
      });
      return { accepted: true as const, job: jobDto(retry) };
    });
  }

  public async audit(query: AuditQuery): Promise<AuditEventList> {
    const offset = decodeOffset(query.cursor);
    const rows = await this.database.client.auditEvent.findMany({
      where: {
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.action
          ? { action: { contains: query.action, mode: "insensitive" as const } }
          : {}),
        ...(query.result ? { result: query.result } : {}),
        ...(query.from || query.to
          ? {
              occurredAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      include: { actor: { select: { id: true, displayName: true } } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: 101,
    });
    return {
      data: rows.slice(0, 100).map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        actor: row.actor,
        workspaceId: row.workspaceId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        result: row.result,
        requestId: row.requestId,
        metadata: safeMetadata(row.metadata),
      })),
      nextCursor: rows.length > 100 ? encodeOffset(offset + 100) : null,
    };
  }

  public async health(): Promise<AdminHealth> {
    const [versionRows, migrationCount, worker] = await Promise.all([
      this.database.client.$queryRaw<{ version: string }[]>`SELECT version() AS version`,
      this.database.client.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
      this.database.client.serviceHeartbeat.findUnique({ where: { service: "worker" } }),
    ]);
    const workerFresh = worker && Date.now() - worker.seenAt.getTime() <= 30_000;
    return {
      status: workerFresh ? "HEALTHY" : "DEGRADED",
      apiVersion: process.env.npm_package_version ?? "0.0.0",
      databaseVersion: versionRows[0]?.version ?? "unknown",
      migrationCount: Number(migrationCount[0]?.count ?? 0),
      uptimeSeconds: Math.floor((Date.now() - processStartedAt) / 1000),
      workerLastSeenAt: worker?.seenAt.toISOString() ?? null,
      checkedAt: new Date().toISOString(),
    };
  }

  private async auditWrite(
    transaction: Prisma.TransactionClient,
    principal: Principal,
    action: string,
    targetId: string,
    requestId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    await transaction.auditEvent.create({
      data: {
        actorUserId: principal.userId,
        workspaceId: principal.workspaceId,
        action,
        targetType: action.startsWith("admin.job") ? "job" : "user",
        targetId,
        result: "SUCCESS",
        requestId,
        metadata,
      },
    });
  }
}

function userSummary(user: {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function configResponse(
  row: { version: number; typedValue: unknown; updatedAt: Date; updatedBy: string } | null,
  fallback: unknown,
): AdminConfigResponse {
  return {
    version: row?.version ?? 1,
    values: AdminConfigValuesSchema.parse(row?.typedValue ?? fallback),
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const denied = /(password|secret|token|markdown|body|content|archive|cookie)/iu;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !denied.test(key))
      .map(([key, nested]) => [key, safeAuditValue(nested, denied, 0)]),
  );
}

function safeAuditValue(value: unknown, denied: RegExp, depth: number): unknown {
  if (depth >= 8) return "[REDACTED_DEPTH]";
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => safeAuditValue(item, denied, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !denied.test(key))
        .map(([key, nested]) => [key, safeAuditValue(nested, denied, depth + 1)]),
    );
  }
  return value;
}

function decodeOffset(cursor?: string): number {
  if (!cursor) return 0;
  const value = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000)
    throw new CodedHttpException("VALIDATION_FAILED", "The cursor is invalid.", 400);
  return value;
}
function encodeOffset(value: number) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}
function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function withJsonFields(value: unknown, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}),
    ...fields,
  };
}
