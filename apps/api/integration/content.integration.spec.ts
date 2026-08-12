import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createDatabaseClient,
  type DatabaseClient,
  ResourceState,
  UserRole,
  UserStatus,
} from "@markora/database";
import { canonicalizeIdentity, NamingPolicy } from "@markora/domain";
import type { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PasswordService } from "../src/auth/password.service.js";
import { hashSessionToken } from "../src/auth/session-token.js";
import { bootstrapAdmin } from "../src/bootstrap-admin.js";
import { createApplication } from "../src/create-app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("markora_test")) {
  throw new Error("Phase 2 integration tests require DATABASE_URL to target markora_test.");
}

Object.assign(process.env, {
  NODE_ENV: "test",
  PUBLIC_ORIGIN: "http://localhost:27183",
  API_HOST: "127.0.0.1",
  API_PORT: "27184",
  SESSION_SECRET: "phase-two-integration-secret-at-least-32-characters",
  SESSION_TTL_DAYS: "30",
  LOGIN_WINDOW_SECONDS: "900",
  LOGIN_MAX_ATTEMPTS: "5",
  ARGON2_MEMORY_KIB: "19456",
  ARGON2_TIME_COST: "2",
  ARGON2_PARALLELISM: "1",
  LOG_LEVEL: "error",
  TEMP_ROOT: "./tmp/integration",
  WORKSPACE_MAX_DEPTH: "32",
  WORKSPACE_NAME_MAX_CODE_POINTS: "255",
  DOCUMENT_MAX_BYTES: "5242880",
  DOCUMENT_LARGE_BYTES: "1024",
  DOCUMENT_LARGE_LINES: "50000",
  VERSION_SNAPSHOT_INTERVAL_MINUTES: "10",
  BOOTSTRAP_ADMIN_USERNAME: "admin",
  BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
  BOOTSTRAP_ADMIN_DISPLAY_NAME: "Administrator",
  BOOTSTRAP_ADMIN_PASSWORD: "Phase2-Integration-Bootstrap-Password!",
});

const origin = process.env.PUBLIC_ORIGIN;
const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const naming = new NamingPolicy();
let app: INestApplication;
let database: DatabaseClient;

beforeAll(async () => {
  database = createDatabaseClient(databaseUrl);
  app = await createApplication();
  await app.init();
});

beforeEach(async () => {
  await database.auditEvent.deleteMany();
  await database.loginAttempt.deleteMany();
  await database.session.deleteMany();
  await database.workspace.deleteMany();
  await database.user.deleteMany();
});

afterAll(async () => {
  await app.close();
  await database.$disconnect();
});

describe("Phase 2 folder and document vertical slice", () => {
  it("creates, renames and moves folders while rejecting cycles atomically", async () => {
    const { agent } = await authenticatedWorkspace();
    const parent = await createFolder(agent, null, "Knowledge");
    const child = await createFolder(agent, parent.id, "Architecture");

    const cycle = await agent
      .patch(`/api/v1/folders/${parent.id}`)
      .set("Origin", origin)
      .send({ parentId: child.id, expectedUpdatedAt: parent.updatedAt })
      .expect(422);
    expect(cycle.body.error.code).toBe("FOLDER_CYCLE");
    expect(
      (await database.folder.findUniqueOrThrow({ where: { id: parent.id } })).parentId,
    ).toBeNull();

    const renamed = await agent
      .patch(`/api/v1/folders/${child.id}`)
      .set("Origin", origin)
      .send({ name: "System Design", parentId: null, expectedUpdatedAt: child.updatedAt })
      .expect(200);
    expect(renamed.body).toMatchObject({ name: "System Design", parentId: null });
  });

  it("enforces Unicode/case sibling uniqueness in API and database", async () => {
    const { agent, workspaceId } = await authenticatedWorkspace();
    await createFolder(agent, null, "Résumé");
    const conflict = await agent
      .post("/api/v1/folders")
      .set("Origin", origin)
      .send({ parentId: null, name: "RE\u0301SUME\u0301" })
      .expect(409);
    expect(conflict.body.error.code).toBe("NAME_CONFLICT");

    await database.folder.create({
      data: { workspaceId, parentId: null, ...naming.validate("Notes", "folder") },
    });
    await expect(
      database.folder.create({
        data: { workspaceId, parentId: null, name: "NOTES", normalizedName: "notes" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("uses stable document IDs and performs no write when opening after ancestor changes", async () => {
    const { agent } = await authenticatedWorkspace();
    const parent = await createFolder(agent, null, "AI");
    const child = await createFolder(agent, parent.id, "Architecture");
    const document = await createDocument(agent, child.id, "Principles.md", "# Principles\n");
    const before = await database.document.findUniqueOrThrow({ where: { id: document.id } });

    const movedParent = await agent
      .patch(`/api/v1/folders/${parent.id}`)
      .set("Origin", origin)
      .send({ name: "Research", expectedUpdatedAt: parent.updatedAt })
      .expect(200);
    expect(movedParent.body.id).toBe(parent.id);

    const opened = await agent.get(`/api/v1/documents/${document.id}`).expect(200);
    expect(opened.body).toMatchObject({ id: document.id, revision: 1, markdown: "# Principles\n" });
    expect(opened.body.breadcrumbs.map((item: { name: string }) => item.name)).toEqual([
      "Research",
      "Architecture",
    ]);
    const after = await database.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(after.revision).toBe(before.revision);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("accepts only safe .md names and rejects independent title metadata", async () => {
    const { agent } = await authenticatedWorkspace();
    const invalidName = await agent
      .post("/api/v1/documents")
      .set("Origin", origin)
      .send({ folderId: null, name: "notes.txt" })
      .expect(422);
    expect(invalidName.body.error.code).toBe("INVALID_NAME");

    await agent
      .post("/api/v1/documents")
      .set("Origin", origin)
      .send({ folderId: null, name: "notes.md", title: "Independent title" })
      .expect(400);
    expect(await database.document.count()).toBe(0);
  });

  it("hides a trashed folder subtree and its documents from every active read", async () => {
    const { agent } = await authenticatedWorkspace();
    const parent = await createFolder(agent, null, "Archive");
    const child = await createFolder(agent, parent.id, "Old");
    const document = await createDocument(agent, child.id, "History.md", "durable");

    await agent.post(`/api/v1/folders/${parent.id}/trash`).set("Origin", origin).expect(201);
    await agent.get(`/api/v1/documents/${document.id}`).expect(404);
    await agent.get(`/api/v1/documents?folderId=${child.id}`).expect(404);
    const tree = await agent.get("/api/v1/folders/tree").expect(200);
    expect(JSON.stringify(tree.body)).not.toContain(parent.id);
    expect((await database.folder.findUniqueOrThrow({ where: { id: parent.id } })).state).toBe(
      ResourceState.TRASHED,
    );
    expect((await database.document.findUniqueOrThrow({ where: { id: document.id } })).state).toBe(
      ResourceState.ACTIVE,
    );
  });

  it("returns 404 for known cross-workspace folder/document IDs without mutation", async () => {
    const { agent, workspaceId } = await authenticatedWorkspace();
    const other = await createOtherWorkspace();
    const otherFolder = await database.folder.create({
      data: { workspaceId: other.workspaceId, ...naming.validate("Private", "folder") },
    });
    const otherDocument = await database.document.create({
      data: {
        workspaceId: other.workspaceId,
        folderId: otherFolder.id,
        markdown: "secret",
        ...naming.validate("Private.md", "document"),
      },
    });

    await agent.get(`/api/v1/documents/${otherDocument.id}`).expect(404);
    await agent.get(`/api/v1/documents?folderId=${otherFolder.id}`).expect(404);
    await agent
      .patch(`/api/v1/folders/${otherFolder.id}`)
      .set("Origin", origin)
      .send({ name: "Stolen", expectedUpdatedAt: otherFolder.updatedAt.toISOString() })
      .expect(404);
    await expect(
      database.document.create({
        data: {
          workspaceId,
          folderId: otherFolder.id,
          ...naming.validate("Cross-tenant.md", "document"),
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await agent
      .post(`/api/v1/documents/${otherDocument.id}/trash`)
      .set("Origin", origin)
      .expect(404);
    expect(
      await database.document.findUniqueOrThrow({ where: { id: otherDocument.id } }),
    ).toMatchObject({
      name: "Private.md",
      markdown: "secret",
      state: ResourceState.ACTIVE,
    });
  });

  it("returns itemized bulk move/trash results and never mutates foreign IDs", async () => {
    const { agent } = await authenticatedWorkspace();
    const target = await createFolder(agent, null, "Target");
    const first = await createDocument(agent, null, "First.md", "one");
    const second = await createDocument(agent, null, "Second.md", "two");
    const other = await createOtherWorkspace();
    const foreign = await database.document.create({
      data: { workspaceId: other.workspaceId, ...naming.validate("Foreign.md", "document") },
    });

    const moved = await agent
      .post("/api/v1/documents/bulk")
      .set("Origin", origin)
      .send({ operation: "MOVE", documentIds: [first.id, foreign.id], targetFolderId: target.id })
      .expect(201);
    expect(moved.body.data).toEqual([
      { documentId: first.id, success: true },
      expect.objectContaining({ documentId: foreign.id, success: false, errorCode: "NOT_FOUND" }),
    ]);
    expect(
      (await database.document.findUniqueOrThrow({ where: { id: foreign.id } })).folderId,
    ).toBeNull();

    await agent
      .post("/api/v1/documents/bulk")
      .set("Origin", origin)
      .send({ operation: "TRASH", documentIds: [first.id, second.id] })
      .expect(201);
    expect(await database.document.count({ where: { state: ResourceState.TRASHED } })).toBe(2);
  });

  it("returns a 10k-node tree within the provisional local baseline", async () => {
    const { agent, workspaceId } = await authenticatedWorkspace();
    await database.$executeRaw`
      INSERT INTO "folders" ("workspace_id", "name", "normalized_name", "updated_at")
      SELECT ${workspaceId}::uuid, 'Folder ' || value, 'folder ' || lpad(value::text, 5, '0'), CURRENT_TIMESTAMP
      FROM generate_series(1, 10000) AS value
    `;
    const startedAt = performance.now();
    const tree = await agent.get("/api/v1/folders/tree").expect(200);
    expect(tree.body.data).toHaveLength(10_000);
    expect(performance.now() - startedAt).toBeLessThan(3_000);
  }, 10_000);
});

describe("Phase 3 revision-guarded document editing", () => {
  it("commits a current revision exactly once and replays the same mutation idempotently", async () => {
    const { agent } = await authenticatedWorkspace();
    const document = await createDocument(agent, null, "Editor.md", "# Before\n");
    const clientMutationId = randomUUID();
    const body = { markdown: "# After\n", baseRevision: 1, clientMutationId };

    const saved = await agent
      .put(`/api/v1/documents/${document.id}/content`)
      .set("Origin", origin)
      .send(body)
      .expect(200);
    expect(saved.body).toMatchObject({
      documentId: document.id,
      revision: 2,
      versionCreated: true,
    });

    const replay = await agent
      .put(`/api/v1/documents/${document.id}/content`)
      .set("Origin", origin)
      .send(body)
      .expect(200);
    expect(replay.body).toEqual(saved.body);
    expect(await database.document.findUniqueOrThrow({ where: { id: document.id } })).toMatchObject(
      {
        markdown: "# After\n",
        revision: 2,
      },
    );
    expect(await database.documentVersion.count({ where: { documentId: document.id } })).toBe(1);
    expect(await database.documentSaveReceipt.count({ where: { documentId: document.id } })).toBe(
      1,
    );
    expect(JSON.stringify(await database.auditEvent.findMany())).not.toContain("# After");
  });

  it("returns a useful revision conflict without overwriting server Markdown", async () => {
    const { agent } = await authenticatedWorkspace();
    const document = await createDocument(agent, null, "Conflict.md", "server one");
    await agent
      .put(`/api/v1/documents/${document.id}/content`)
      .set("Origin", origin)
      .send({ markdown: "server two", baseRevision: 1, clientMutationId: randomUUID() })
      .expect(200);

    const stale = await agent
      .put(`/api/v1/documents/${document.id}/content`)
      .set("Origin", origin)
      .send({ markdown: "local stale", baseRevision: 1, clientMutationId: randomUUID() })
      .expect(409);
    expect(stale.body.error).toMatchObject({
      code: "REVISION_CONFLICT",
      details: { documentId: document.id, serverRevision: 2, serverMarkdown: "server two" },
    });
    expect(await database.document.findUniqueOrThrow({ where: { id: document.id } })).toMatchObject(
      {
        markdown: "server two",
        revision: 2,
      },
    );
  });

  it("protects conflict overwrite with a version snapshot and rejects cross-workspace saves", async () => {
    const { agent } = await authenticatedWorkspace();
    const document = await createDocument(agent, null, "Resolution.md", "server current");
    const resolved = await agent
      .put(`/api/v1/documents/${document.id}/content`)
      .set("Origin", origin)
      .send({
        markdown: "explicit local current",
        baseRevision: 1,
        clientMutationId: randomUUID(),
        conflictResolution: "OVERWRITE_SERVER",
      })
      .expect(200);
    expect(resolved.body).toMatchObject({ revision: 2, versionCreated: true });
    expect(
      await database.documentVersion.findFirstOrThrow({ where: { documentId: document.id } }),
    ).toMatchObject({
      markdown: "server current",
      sourceRevision: 1,
      reason: "CONFLICT_OVERWRITE",
    });

    const other = await createOtherWorkspace();
    const foreign = await database.document.create({
      data: { workspaceId: other.workspaceId, ...naming.validate("Foreign-save.md", "document") },
    });
    await agent
      .put(`/api/v1/documents/${foreign.id}/content`)
      .set("Origin", origin)
      .send({ markdown: "stolen", baseRevision: 1, clientMutationId: randomUUID() })
      .expect(404);
    expect(
      (await database.document.findUniqueOrThrow({ where: { id: foreign.id } })).markdown,
    ).toBe("");
  });

  it("does not increment revision for an unchanged save and flags large documents", async () => {
    const { agent } = await authenticatedWorkspace();
    const markdown = "x".repeat(120_000);
    const document = await createDocument(agent, null, "Large.md", markdown);
    expect(document.capabilities).toEqual({
      source: true,
      wysiwyg: false,
      split: false,
      largeDocument: true,
    });
    const noChange = await agent
      .put(`/api/v1/documents/${document.id}/content`)
      .set("Origin", origin)
      .send({ markdown, baseRevision: 1, clientMutationId: randomUUID() })
      .expect(200);
    expect(noChange.body).toMatchObject({ revision: 1, versionCreated: false });
    expect(await database.documentVersion.count({ where: { documentId: document.id } })).toBe(0);
  });
});

async function authenticatedWorkspace() {
  const created = await bootstrapAdmin(database, process.env);
  const agent = supertest.agent(app.getHttpServer());
  await agent
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .send({ identifier: "admin", password: bootstrapPassword })
    .expect(200);
  return { agent, workspaceId: created.workspaceId };
}

async function createFolder(
  agent: ReturnType<typeof supertest.agent>,
  parentId: string | null,
  name: string,
) {
  return (
    await agent.post("/api/v1/folders").set("Origin", origin).send({ parentId, name }).expect(201)
  ).body as { id: string; parentId: string | null; name: string; updatedAt: string };
}

async function createDocument(
  agent: ReturnType<typeof supertest.agent>,
  folderId: string | null,
  name: string,
  markdown: string,
) {
  return (
    await agent
      .post("/api/v1/documents")
      .set("Origin", origin)
      .send({ folderId, name, markdown })
      .expect(201)
  ).body as {
    id: string;
    folderId: string | null;
    name: string;
    updatedAt: string;
    capabilities: { source: boolean; wysiwyg: boolean; split: boolean; largeDocument: boolean };
  };
}

async function createOtherWorkspace() {
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await new PasswordService().hash("Other-Workspace-Password-2026!");
  const user = await database.user.create({
    data: {
      username: `other-${suffix}`,
      usernameCanonical: canonicalizeIdentity(`other-${suffix}`),
      email: `other-${suffix}@example.com`,
      emailCanonical: canonicalizeIdentity(`other-${suffix}@example.com`),
      displayName: "Other User",
      passwordHash,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      workspace: { create: {} },
    },
    include: { workspace: true },
  });
  await database.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(randomBytes(32).toString("base64url")),
      familyId: randomUUID(),
      userAgentSummary: "Other browser",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  if (!user.workspace) throw new Error("Other workspace was not created.");
  return { userId: user.id, workspaceId: user.workspace.id };
}
