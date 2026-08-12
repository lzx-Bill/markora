import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
  BackgroundJobState,
  BackgroundJobType,
  createDatabaseClient,
  type DatabaseClient,
  UserRole,
  UserStatus,
} from "@markora/database";
import { canonicalizeIdentity } from "@markora/domain";
import type { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PasswordService } from "../src/auth/password.service.js";
import { bootstrapAdmin } from "../src/bootstrap-admin.js";
import { createApplication } from "../src/create-app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("markora_test")) {
  throw new Error("Phase 7 integration tests require DATABASE_URL to target markora_test.");
}
const origin = "http://localhost:27183";
const bootstrapPassword = "Phase7-Integration-Bootstrap-Password!";
Object.assign(process.env, {
  NODE_ENV: "test",
  PUBLIC_ORIGIN: origin,
  DATABASE_URL: databaseUrl,
  SESSION_SECRET: "phase-seven-api-secret-at-least-32-characters",
  BOOTSTRAP_ADMIN_USERNAME: "admin",
  BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
  BOOTSTRAP_ADMIN_DISPLAY_NAME: "Administrator",
  BOOTSTRAP_ADMIN_PASSWORD: bootstrapPassword,
  ARGON2_MEMORY_KIB: "19456",
  ARGON2_TIME_COST: "2",
  ARGON2_PARALLELISM: "1",
  LOG_LEVEL: "error",
});

let app: INestApplication;
let database: DatabaseClient;

beforeAll(async () => {
  database = createDatabaseClient(databaseUrl);
  app = await createApplication();
  await app.init();
});

beforeEach(async () => {
  await database.$executeRaw`TRUNCATE TABLE "audit_events"`;
  await database.systemConfig.deleteMany();
  await database.serviceHeartbeat.deleteMany();
  await database.loginAttempt.deleteMany();
  await database.session.deleteMany();
  await database.workspace.deleteMany();
  await database.user.deleteMany();
});

afterAll(async () => {
  await app.close();
  await database.$disconnect();
});

describe("Phase 7 preferences and administration", () => {
  it("saves a typed preference patch with version protection and no partial stale write", async () => {
    const admin = await authenticatedAdmin();
    const initial = await admin.get("/api/v1/preferences").expect(200);
    expect(initial.body).toMatchObject({ version: 1, settings: { theme: "SYSTEM" } });
    const updated = await admin
      .patch("/api/v1/preferences")
      .set("Origin", origin)
      .send({ version: 1, displayName: "Updated Admin", settings: { theme: "DARK", tabSize: 4 } })
      .expect(200);
    expect(updated.body).toMatchObject({
      version: 2,
      displayName: "Updated Admin",
      settings: { theme: "DARK", tabSize: 4 },
    });
    const second = await admin
      .patch("/api/v1/preferences")
      .set("Origin", origin)
      .send({ version: 2, settings: { accent: "INDIGO" } })
      .expect(200);
    expect(second.body).toMatchObject({
      version: 3,
      settings: { theme: "DARK", accent: "INDIGO", tabSize: 4 },
    });
    await admin
      .patch("/api/v1/preferences")
      .set("Origin", origin)
      .send({ version: 1, settings: { theme: "LIGHT" } })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("CONFIG_VERSION_CONFLICT"));
    expect((await admin.get("/api/v1/preferences")).body.settings).toMatchObject({
      theme: "DARK",
      accent: "INDIGO",
      tabSize: 4,
    });
  });

  it("hides every admin route from a regular user and returns no other-user content", async () => {
    const admin = await authenticatedAdmin();
    const regular = await createAndLoginUser("regular", UserRole.USER);
    for (const path of ["overview", "users", "config", "security", "jobs", "audit", "health"]) {
      await regular.agent.get(`/api/v1/admin/${path}`).expect(403);
    }
    const secretName = "PRIVATE-NAME-NEVER-RETURN.md";
    const secretBody = "PRIVATE-MARKDOWN-BODY-NEVER-RETURN";
    await database.document.create({
      data: {
        workspaceId: regular.workspaceId,
        name: secretName,
        normalizedName: secretName.toLocaleLowerCase(),
        markdown: secretBody,
      },
    });
    const detail = await admin.get(`/api/v1/admin/users/${regular.userId}`).expect(200);
    const serialized = JSON.stringify(detail.body);
    expect(detail.body.counts.documents).toBe(1);
    expect(serialized).not.toContain(secretName);
    expect(serialized).not.toContain(secretBody);
    expect(serialized).not.toContain("markdown");
  });

  it("protects the last active admin and revokes sessions on disable/password reset", async () => {
    const admin = await authenticatedAdmin();
    const me = await database.user.findUniqueOrThrow({ where: { usernameCanonical: "admin" } });
    await admin
      .patch(`/api/v1/admin/users/${me.id}`)
      .set("Origin", origin)
      .send({ role: "USER" })
      .expect(409);
    const created = await admin
      .post("/api/v1/admin/users")
      .set("Origin", origin)
      .send({
        username: "second-admin",
        email: "second@example.com",
        displayName: "Second",
        temporaryPassword: "Temporary-Password-2026!",
        role: "ADMIN",
      })
      .expect(201);
    expect(JSON.stringify(created.body)).not.toContain("Temporary-Password-2026!");
    await admin
      .patch(`/api/v1/admin/users/${me.id}`)
      .set("Origin", origin)
      .send({ role: "USER" })
      .expect(200);
    await admin.get("/api/v1/admin/overview").expect(403);
    const secondAdmin = supertest.agent(app.getHttpServer());
    await secondAdmin
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send({ identifier: "second-admin", password: "Temporary-Password-2026!" })
      .expect(200);
    await secondAdmin
      .post("/api/v1/account/password")
      .set("Origin", origin)
      .send({
        currentPassword: "Temporary-Password-2026!",
        newPassword: "Second-Admin-Owned-Password-2026!",
      })
      .expect(200);
    const regular = await createAndLoginUser("disable-me", UserRole.USER);
    await secondAdmin
      .patch(`/api/v1/admin/users/${regular.userId}`)
      .set("Origin", origin)
      .send({ status: "DISABLED" })
      .expect(200);
    await regular.agent.get("/api/v1/auth/me").expect(401);
    const target = await createAndLoginUser("reset-me", UserRole.USER);
    await secondAdmin
      .post(`/api/v1/admin/users/${target.userId}/reset-password`)
      .set("Origin", origin)
      .send({ temporaryPassword: "Replacement-Password-2026!" })
      .expect(201);
    await target.agent.get("/api/v1/auth/me").expect(401);
    expect(
      (await database.user.findUniqueOrThrow({ where: { id: target.userId } })).mustChangePassword,
    ).toBe(true);
  });

  it("applies only a full reviewed config version and audits success and failure without secrets", async () => {
    const admin = await authenticatedAdmin();
    const current = await admin.get("/api/v1/admin/config").expect(200);
    const values = {
      ...current.body.values,
      documentMaxBytes: 1024,
      externalImagesEnabled: true,
    };
    const applied = await admin
      .put("/api/v1/admin/config")
      .set("Origin", origin)
      .send({ version: current.body.version, values })
      .expect(200);
    expect(applied.body.version).toBe(2);
    await admin
      .post("/api/v1/documents")
      .set("Origin", origin)
      .send({ folderId: null, name: "runtime-limit.md", markdown: "x".repeat(1025) })
      .expect(413)
      .expect(({ body }) => expect(body.error.code).toBe("LIMIT_EXCEEDED"));
    const preferences = await admin.get("/api/v1/preferences").expect(200);
    await admin
      .patch("/api/v1/preferences")
      .set("Origin", origin)
      .send({
        version: preferences.body.version,
        settings: { externalImages: true },
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.capabilities.externalImages).toBe(true);
        expect(body.settings.externalImages).toBe(true);
      });
    await admin
      .put("/api/v1/admin/config")
      .set("Origin", origin)
      .send({ version: 1, values: { ...values, trashRetentionDays: 99 } })
      .expect(409);
    expect((await admin.get("/api/v1/admin/config")).body.values.trashRetentionDays).toBe(
      values.trashRetentionDays,
    );
    const events = await admin.get("/api/v1/admin/audit?action=admin.config.apply").expect(200);
    expect(events.body.data.map((event: { result: string }) => event.result).sort()).toEqual([
      "FAILURE",
      "SUCCESS",
    ]);
    expect(JSON.stringify(events.body)).not.toMatch(
      /password|secret|token|markdown|body|content/iu,
    );
    const security = await admin.get("/api/v1/admin/security").expect(200);
    expect(security.body.immutable).toMatchObject({
      sanitizerRequired: true,
      scriptsBlocked: true,
      unsafeUrlsBlocked: true,
    });
  });

  it("enforces append-only audit rows and reports real database/worker health", async () => {
    const admin = await authenticatedAdmin();
    const actor = await database.user.findUniqueOrThrow({
      where: { usernameCanonical: "admin" },
      include: { workspace: true },
    });
    if (!actor.workspace) throw new Error("Workspace missing.");
    await database.auditEvent.create({
      data: {
        actorUserId: actor.id,
        workspaceId: actor.workspace.id,
        action: "redaction.probe",
        targetType: "probe",
        result: "SUCCESS",
        requestId: "redaction_probe",
        metadata: {
          safe: "visible",
          nested: { password: "hidden-password", details: { markdown: "hidden-markdown" } },
          list: [{ token: "hidden-token", count: 1 }],
        },
      },
    });
    const redacted = await admin.get("/api/v1/admin/audit?action=redaction.probe").expect(200);
    expect(redacted.body.data[0].metadata).toEqual({
      safe: "visible",
      nested: { details: {} },
      list: [{ count: 1 }],
    });
    expect(JSON.stringify(redacted.body)).not.toMatch(
      /hidden-password|hidden-markdown|hidden-token/u,
    );
    await admin.get("/api/v1/admin/overview").expect(200);
    const event = await database.auditEvent.findFirstOrThrow();
    await expect(
      database.auditEvent.update({ where: { id: event.id }, data: { action: "tampered" } }),
    ).rejects.toThrow(/append-only/u);
    await expect(database.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(
      /append-only/u,
    );
    await database.serviceHeartbeat.upsert({
      where: { service: "worker" },
      create: {
        service: "worker",
        instance: "integration-worker",
        startedAt: new Date(),
        seenAt: new Date(),
      },
      update: { instance: "integration-worker", seenAt: new Date() },
    });
    const health = await admin.get("/api/v1/admin/health").expect(200);
    expect(health.body).toMatchObject({ status: "HEALTHY" });
    expect(health.body.databaseVersion).toContain("PostgreSQL");
    expect(health.body.migrationCount).toBeGreaterThan(0);
  });

  it("retries an export from its immutable snapshot and reuses an active retry", async () => {
    const admin = await authenticatedAdmin();
    const owner = await database.user.findUniqueOrThrow({
      where: { usernameCanonical: "admin" },
      include: { workspace: true },
    });
    if (!owner.workspace) throw new Error("Workspace missing.");
    const documentId = randomUUID();
    const source = await database.backgroundJob.create({
      data: {
        workspaceId: owner.workspace.id,
        ownerUserId: owner.id,
        type: BackgroundJobType.EXPORT,
        state: BackgroundJobState.FAILED,
        targetType: "export",
        targetId: owner.workspace.id,
        payload: { downloadExpiresAt: new Date(Date.now() + 3_600_000).toISOString() },
        checkpoint: { completed: 0, total: 1, phase: "failed", currentItem: null },
        errorCode: "DEPENDENCY_UNAVAILABLE",
        exportManifest: {
          create: {
            scope: "workspace",
            report: { mappings: [] },
            items: {
              create: {
                sourceDocumentId: documentId,
                displayPath: "snapshot.md",
                archivePath: "snapshot.md",
                markdown: "# immutable snapshot",
                sourceRevision: 7,
              },
            },
          },
        },
        items: { create: { sourceKey: documentId, payload: { archivePath: "snapshot.md" } } },
      },
    });
    const first = await admin
      .post(`/api/v1/admin/jobs/${source.id}/retry`)
      .set("Origin", origin)
      .expect(201);
    const retry = await database.backgroundJob.findUniqueOrThrow({
      where: { id: first.body.job.id },
      include: { exportManifest: { include: { items: true } } },
    });
    expect(retry.parentJobId).toBe(source.id);
    expect(retry.exportManifest?.items[0]).toMatchObject({
      markdown: "# immutable snapshot",
      sourceRevision: 7,
    });
    const second = await admin
      .post(`/api/v1/admin/jobs/${source.id}/retry`)
      .set("Origin", origin)
      .expect(201);
    expect(second.body.job.id).toBe(retry.id);
  });
});

async function authenticatedAdmin() {
  await bootstrapAdmin(database, process.env);
  const agent = supertest.agent(app.getHttpServer());
  await agent
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .send({ identifier: "admin", password: bootstrapPassword })
    .expect(200);
  return agent;
}

async function createAndLoginUser(prefix: string, role: UserRole) {
  const suffix = randomUUID().slice(0, 8);
  const username = `${prefix}-${suffix}`;
  const password = "Regular-User-Password-2026!";
  const passwordHash = await new PasswordService().hash(password);
  const user = await database.user.create({
    data: {
      username,
      usernameCanonical: canonicalizeIdentity(username),
      email: `${username}@example.com`,
      emailCanonical: canonicalizeIdentity(`${username}@example.com`),
      displayName: prefix,
      passwordHash,
      role,
      status: UserStatus.ACTIVE,
      workspace: { create: {} },
    },
    include: { workspace: true },
  });
  if (!user.workspace) throw new Error("Workspace missing.");
  const agent = supertest.agent(app.getHttpServer());
  await agent
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .send({ identifier: username, password })
    .expect(200);
  return { agent, userId: user.id, workspaceId: user.workspace.id };
}
