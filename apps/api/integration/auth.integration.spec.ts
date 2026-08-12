import "reflect-metadata";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDatabaseClient, type DatabaseClient, UserRole, UserStatus } from "@markora/database";
import { canonicalizeIdentity } from "@markora/domain";
import type { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PasswordService } from "../src/auth/password.service.js";
import { hashSessionToken } from "../src/auth/session-token.js";
import { BootstrapDisabledError, bootstrapAdmin } from "../src/bootstrap-admin.js";
import { createApplication } from "../src/create-app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("markora_test")) {
  throw new Error("Phase 1 integration tests require DATABASE_URL to target markora_test.");
}

Object.assign(process.env, {
  NODE_ENV: "test",
  PUBLIC_ORIGIN: "http://localhost:27183",
  API_HOST: "127.0.0.1",
  API_PORT: "27184",
  SESSION_SECRET: "phase-one-integration-secret-at-least-32-characters",
  SESSION_TTL_DAYS: "30",
  LOGIN_WINDOW_SECONDS: "900",
  LOGIN_MAX_ATTEMPTS: "3",
  ARGON2_MEMORY_KIB: "19456",
  ARGON2_TIME_COST: "2",
  ARGON2_PARALLELISM: "1",
  LOG_LEVEL: "error",
  TEMP_ROOT: "./tmp/integration",
  BOOTSTRAP_ADMIN_USERNAME: "admin",
  BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
  BOOTSTRAP_ADMIN_DISPLAY_NAME: "Administrator",
  BOOTSTRAP_ADMIN_PASSWORD: "Phase1-Integration-Bootstrap-Password!",
});

const origin = process.env.PUBLIC_ORIGIN;
const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
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

describe("Phase 1 identity and isolation", () => {
  it("creates exactly one bootstrap admin and disables the path afterward", async () => {
    const created = await bootstrapAdmin(database, process.env);
    await expect(bootstrapAdmin(database, process.env)).rejects.toBeInstanceOf(
      BootstrapDisabledError,
    );

    const user = await database.user.findUniqueOrThrow({
      where: { id: created.userId },
      include: { workspace: true },
    });
    expect(user.role).toBe(UserRole.ADMIN);
    expect(user.mustChangePassword).toBe(true);
    expect(user.workspace?.id).toBe(created.workspaceId);
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(bootstrapPassword);
    expect(await database.user.count()).toBe(1);
    expect(await database.workspace.count()).toBe(1);
  });

  it("has no public registration or email-reset endpoints", async () => {
    await supertest(app.getHttpServer()).post("/api/v1/register").set("Origin", origin).expect(404);
    await supertest(app.getHttpServer())
      .post("/api/v1/auth/forgot-password")
      .set("Origin", origin)
      .expect(404);
  });

  it("creates only a hashed opaque session and audits generic login failures", async () => {
    await bootstrapAdmin(database, process.env);
    const agent = supertest.agent(app.getHttpServer());
    const login = await agent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .set("User-Agent", "Markora integration browser")
      .send({ identifier: "ADMIN", password: bootstrapPassword })
      .expect(200);

    expect(login.body.principal.username).toBe("admin");
    expect(login.body).not.toHaveProperty("token");
    const setCookie = login.headers["set-cookie"] as unknown as string[];
    expect(setCookie[0]).toContain("HttpOnly");
    expect(setCookie[0]).toContain("SameSite=Strict");
    const rawToken = setCookie[0]?.match(/markora_session=([^;]+)/u)?.[1];
    expect(rawToken).toBeTruthy();

    const storedSession = await database.session.findFirstOrThrow();
    expect(storedSession.tokenHash).toBe(
      createHash("sha256")
        .update(decodeURIComponent(rawToken ?? ""))
        .digest("hex"),
    );
    expect(storedSession.tokenHash).not.toBe(rawToken);

    const failure = await supertest(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send({ identifier: "unknown", password: "wrong-password" })
      .expect(401);
    expect(failure.body.error.code).toBe("AUTHENTICATION_FAILED");
    const auditEvents = await database.auditEvent.findMany({
      where: { action: "auth.login" },
      orderBy: { occurredAt: "asc" },
    });
    expect(auditEvents).toEqual([
      expect.objectContaining({ action: "auth.login", result: "SUCCESS" }),
      expect.objectContaining({ action: "auth.login", result: "FAILURE" }),
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain("wrong-password");
  });

  it("rate limits invalid login attempts and rejects requests without a valid origin", async () => {
    await bootstrapAdmin(database, process.env);
    const payload = { identifier: "admin", password: "wrong-password" };

    await supertest(app.getHttpServer()).post("/api/v1/auth/login").send(payload).expect(403);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await supertest(app.getHttpServer())
        .post("/api/v1/auth/login")
        .set("Origin", origin)
        .send(payload)
        .expect(401);
    }
    const limited = await supertest(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send(payload)
      .expect(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });

  it("invalidates an existing session as soon as the user is disabled", async () => {
    const created = await bootstrapAdmin(database, process.env);
    const agent = await authenticatedAgent();
    await agent.get("/api/v1/auth/me").expect(200);

    await database.user.update({
      where: { id: created.userId },
      data: { status: UserStatus.DISABLED },
    });
    const denied = await agent.get("/api/v1/auth/me").expect(401);
    expect(denied.body.error.code).toBe("SESSION_REVOKED");
    expect((await database.session.findFirstOrThrow()).revokedAt).not.toBeNull();
  });

  it("scopes session reads and revocation by the authenticated user", async () => {
    const created = await bootstrapAdmin(database, process.env);
    const agent = await authenticatedAgent();
    const current = await database.session.findFirstOrThrow({ where: { userId: created.userId } });
    const otherSession = await createOtherUserSession();

    const list = await agent.get("/api/v1/sessions").expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id: current.id, current: true });

    const denied = await agent
      .delete(`/api/v1/sessions/${otherSession.id}`)
      .set("Origin", origin)
      .expect(404);
    expect(denied.body.error.code).toBe("NOT_FOUND");
    expect(
      (await database.session.findUniqueOrThrow({ where: { id: otherSession.id } })).revokedAt,
    ).toBeNull();
  });

  it("revokes all other owned sessions while preserving the current session", async () => {
    const created = await bootstrapAdmin(database, process.env);
    const agent = await authenticatedAgent();
    const current = await database.session.findFirstOrThrow({ where: { userId: created.userId } });
    const second = await database.session.create({
      data: {
        userId: created.userId,
        tokenHash: hashSessionToken(randomBytes(32).toString("base64url")),
        familyId: randomUUID(),
        userAgentSummary: "Other browser",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await agent.post("/api/v1/sessions/revoke-others").set("Origin", origin).expect(200);
    expect(
      (await database.session.findUniqueOrThrow({ where: { id: current.id } })).revokedAt,
    ).toBeNull();
    expect(
      (await database.session.findUniqueOrThrow({ where: { id: second.id } })).revokedAt,
    ).not.toBeNull();
  });
});

async function authenticatedAgent() {
  const agent = supertest.agent(app.getHttpServer());
  await agent
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .send({ identifier: "admin", password: bootstrapPassword })
    .expect(200);
  return agent;
}

async function createOtherUserSession() {
  const passwords = new PasswordService();
  const other = await database.user.create({
    data: {
      username: "other",
      usernameCanonical: canonicalizeIdentity("other"),
      email: "other@example.com",
      emailCanonical: canonicalizeIdentity("other@example.com"),
      displayName: "Other User",
      passwordHash: await passwords.hash("Other-User-Password-2026!"),
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      workspace: { create: {} },
    },
  });
  return database.session.create({
    data: {
      userId: other.id,
      tokenHash: hashSessionToken(randomBytes(32).toString("base64url")),
      familyId: randomUUID(),
      userAgentSummary: "Other user's browser",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
}
