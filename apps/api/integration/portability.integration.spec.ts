import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";
import {
  BackgroundJobState,
  BackgroundJobType,
  createDatabaseClient,
  type DatabaseClient,
  JobItemState,
  UserRole,
  UserStatus,
} from "@markora/database";
import { canonicalizeIdentity } from "@markora/domain";
import { extractMarkdownZip, privatePath } from "@markora/portability";
import type { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseService as WorkerDatabaseService } from "../../worker/src/database.service.js";
import { ImportExportRunner } from "../../worker/src/import-export.runner.js";
import { RuntimeConfigService as WorkerRuntimeConfigService } from "../../worker/src/runtime-config.service.js";
import { PasswordService } from "../src/auth/password.service.js";
import { bootstrapAdmin } from "../src/bootstrap-admin.js";
import { createApplication } from "../src/create-app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("markora_test")) {
  throw new Error("Phase 6 API integration tests require DATABASE_URL to target markora_test.");
}

const origin = "http://localhost:27183";
const temporaryRoot = resolve("tmp/api-phase-6");
const bootstrapPassword = "Phase6-Integration-Bootstrap-Password!";
Object.assign(process.env, {
  NODE_ENV: "test",
  PUBLIC_ORIGIN: origin,
  API_HOST: "127.0.0.1",
  API_PORT: "27184",
  SESSION_SECRET: "phase-six-api-secret-at-least-32-characters",
  DATABASE_URL: databaseUrl,
  TEMP_ROOT: temporaryRoot,
  ARGON2_MEMORY_KIB: "19456",
  ARGON2_TIME_COST: "2",
  ARGON2_PARALLELISM: "1",
  LOG_LEVEL: "error",
  BOOTSTRAP_ADMIN_USERNAME: "admin",
  BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
  BOOTSTRAP_ADMIN_DISPLAY_NAME: "Administrator",
  BOOTSTRAP_ADMIN_PASSWORD: bootstrapPassword,
});

let app: INestApplication;
let database: DatabaseClient;

beforeAll(async () => {
  database = createDatabaseClient(databaseUrl);
  app = await createApplication();
  await app.init();
});

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
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
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("Phase 6 portability API", () => {
  it("requires a bound preview, reports ignored files and executes idempotently", async () => {
    const { agent, workspaceId } = await authenticatedWorkspace();
    const upload = await agent
      .post("/api/v1/imports/uploads")
      .set("Origin", origin)
      .field("relativePaths", JSON.stringify(["Notes/One.md", "Notes/image.png"]))
      .attach("files", Buffer.from("# One\r\n原始内容", "utf8"), "One.md")
      .attach("files", Buffer.from([1, 2, 3]), "image.png")
      .expect(201);
    const preview = await agent
      .post("/api/v1/imports/preview")
      .set("Origin", origin)
      .send({ uploadToken: upload.body.uploadToken, targetFolderId: null })
      .expect(201);
    expect(preview.body).toMatchObject({
      targetFolderId: null,
      summary: { documents: 1, folders: 1, ignoredNonMarkdown: 1, totalBytes: 19 },
      warnings: [{ code: "IGNORED_NON_MARKDOWN", count: 1 }],
    });
    const idempotencyKey = randomUUID();
    const first = await agent
      .post(`/api/v1/imports/${preview.body.planId}/execute`)
      .set("Origin", origin)
      .send({ idempotencyKey, conflictStrategy: "KEEP_BOTH", overrides: [] })
      .expect(202);
    const repeated = await agent
      .post(`/api/v1/imports/${preview.body.planId}/execute`)
      .set("Origin", origin)
      .send({ idempotencyKey, conflictStrategy: "SKIP", overrides: [] })
      .expect(202);
    expect(repeated.body.job.id).toBe(first.body.job.id);
    expect(await database.jobItem.count({ where: { jobId: first.body.job.id } })).toBe(1);
    expect(await database.backgroundJob.count({ where: { workspaceId } })).toBe(1);

    await drainWorker();
    expect(await agent.get(`/api/v1/jobs/${first.body.job.id}`).expect(200)).toMatchObject({
      body: { state: "SUCCEEDED", progress: 100, result: { total: 1, succeeded: 1 } },
    });
    expect(await database.document.findFirstOrThrow({ where: { workspaceId } })).toMatchObject({
      name: "One.md",
      markdown: "# One\r\n原始内容",
    });
  });

  it("rejects traversal before a plan exists and hides tokens and jobs across workspaces", async () => {
    const owner = await authenticatedWorkspace();
    const other = await authenticatedOtherWorkspace();
    await owner.agent
      .post("/api/v1/imports/uploads")
      .set("Origin", origin)
      .field("relativePaths", JSON.stringify(["../escape.md"]))
      .attach("files", Buffer.from("unsafe"), "escape.md")
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("UNSAFE_ARCHIVE"));

    const upload = await owner.agent
      .post("/api/v1/imports/uploads")
      .set("Origin", origin)
      .field("relativePaths", JSON.stringify(["Private.md"]))
      .attach("files", Buffer.from("private"), "Private.md")
      .expect(201);
    await other.agent
      .post("/api/v1/imports/preview")
      .set("Origin", origin)
      .send({ uploadToken: upload.body.uploadToken, targetFolderId: null })
      .expect(410);
    const preview = await owner.agent
      .post("/api/v1/imports/preview")
      .set("Origin", origin)
      .send({ uploadToken: upload.body.uploadToken, targetFolderId: null })
      .expect(201);
    const execution = await owner.agent
      .post(`/api/v1/imports/${preview.body.planId}/execute`)
      .set("Origin", origin)
      .send({ idempotencyKey: randomUUID(), conflictStrategy: "KEEP_BOTH", overrides: [] })
      .expect(202);
    await other.agent.get(`/api/v1/jobs/${execution.body.job.id}`).expect(404);
    await supertest(app.getHttpServer()).get(`/api/v1/jobs/${execution.body.job.id}`).expect(401);
  });

  it("downloads exact Markdown and exports one immutable hierarchy snapshot", async () => {
    const owner = await authenticatedWorkspace();
    const other = await authenticatedOtherWorkspace();
    const folder = await database.folder.create({
      data: {
        workspaceId: owner.workspaceId,
        name: "A:Folder",
        normalizedName: "a:folder",
      },
    });
    const raw = "---\r\nraw: yes\r\n---\r\n<script>source</script>";
    const document = await database.document.create({
      data: {
        workspaceId: owner.workspaceId,
        folderId: folder.id,
        name: "N?ote.md",
        normalizedName: "n?ote.md",
        markdown: raw,
      },
    });
    const direct = await owner.agent.get(`/api/v1/documents/${document.id}/download`).expect(200);
    expect(direct.text).toBe(raw);
    expect(direct.headers["content-disposition"]).toContain("N?ote.md");

    const created = await owner.agent
      .post("/api/v1/exports")
      .set("Origin", origin)
      .send({ scope: "workspace", idempotencyKey: randomUUID() })
      .expect(202);
    await database.document.update({
      where: { id: document.id },
      data: { markdown: "changed later", revision: { increment: 1 } },
    });
    await other.agent
      .get(`/api/v1/exports/${created.body.job.id}/download`)
      .query({ token: created.body.downloadToken })
      .expect(403);
    await owner.agent
      .get(`/api/v1/exports/${created.body.job.id}/download`)
      .query({ token: created.body.downloadToken })
      .expect(409);

    await drainWorker();
    const artifact = await database.exportArtifact.findUniqueOrThrow({
      where: { jobId: created.body.job.id },
    });
    const extracted = await extractMarkdownZip(
      artifact.filePath,
      privatePath(temporaryRoot, "verify", `job_${created.body.job.id.replaceAll("-", "")}`),
      {
        maxFiles: 10,
        maxTotalBytes: 1024 * 1024,
        maxEntryBytes: 1024 * 1024,
        maxCompressionRatio: 1000,
        maxDepth: 8,
      },
    );
    const markdownEntry = extracted.entries.find(({ relativePath }) =>
      relativePath.endsWith(".md"),
    );
    expect(markdownEntry?.relativePath).toBe("A_Folder/N_ote.md");
    expect(await readFile(markdownEntry?.storagePath ?? "", "utf8")).toBe(raw);
    const downloaded = await owner.agent
      .get(`/api/v1/exports/${created.body.job.id}/download`)
      .query({ token: created.body.downloadToken })
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(downloaded.headers["content-type"]).toContain("application/zip");
    expect(Buffer.isBuffer(downloaded.body)).toBe(true);

    const folderExport = await owner.agent
      .post("/api/v1/exports")
      .set("Origin", origin)
      .send({ scope: "folder", folderId: folder.id, idempotencyKey: randomUUID() })
      .expect(202);
    await drainWorker();
    expect(await archiveMarkdownPaths(folderExport.body.job.id)).toEqual(["A_Folder/N_ote.md"]);

    const selectionExport = await owner.agent
      .post("/api/v1/exports")
      .set("Origin", origin)
      .send({ scope: "selection", ids: [document.id], idempotencyKey: randomUUID() })
      .expect(202);
    await drainWorker();
    expect(await archiveMarkdownPaths(selectionExport.body.job.id)).toEqual(["A_Folder/N_ote.md"]);
    expect(
      await database.auditEvent.findMany({
        where: { action: { startsWith: "export." } },
        select: { action: true },
      }),
    ).toEqual(expect.arrayContaining([{ action: "export.create" }, { action: "export.download" }]));
  });

  it("retries only failed import items and allows only valid cancellation states", async () => {
    const { agent, workspaceId } = await authenticatedWorkspace();
    const owner = await database.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const source = await database.backgroundJob.create({
      data: {
        workspaceId,
        ownerUserId: owner.ownerUserId,
        type: BackgroundJobType.IMPORT,
        targetType: "import-plan",
        targetId: randomUUID(),
        state: BackgroundJobState.SUCCEEDED_WITH_ISSUES,
        completedAt: new Date(),
        items: {
          create: [
            { sourceKey: "ok", state: JobItemState.SUCCEEDED, payload: { path: "ok.md" } },
            { sourceKey: "failed", state: JobItemState.FAILED, payload: { path: "failed.md" } },
          ],
        },
      },
    });
    const retried = await agent
      .post(`/api/v1/jobs/${source.id}/retry-failed`)
      .set("Origin", origin)
      .expect(201);
    expect(retried.body.job.parentJobId).toBe(source.id);
    expect(await database.jobItem.findMany({ where: { jobId: retried.body.job.id } })).toEqual([
      expect.objectContaining({ sourceKey: "failed", state: JobItemState.PENDING }),
    ]);
    await database.jobItem.updateMany({
      where: { jobId: retried.body.job.id },
      data: { state: JobItemState.SUCCEEDED },
    });
    await database.backgroundJob.update({
      where: { id: retried.body.job.id },
      data: { state: BackgroundJobState.SUCCEEDED, completedAt: new Date() },
    });
    await agent.post(`/api/v1/jobs/${source.id}/retry-failed`).set("Origin", origin).expect(409);
    await agent.post(`/api/v1/jobs/${source.id}/cancel`).set("Origin", origin).expect(409);
    const cancellable = await database.backgroundJob.create({
      data: {
        workspaceId,
        ownerUserId: owner.ownerUserId,
        type: BackgroundJobType.EXPORT,
        targetType: "export",
        targetId: workspaceId,
      },
    });
    await agent.post(`/api/v1/jobs/${cancellable.id}/cancel`).set("Origin", origin).expect(201);
    expect(
      await database.backgroundJob.findUniqueOrThrow({ where: { id: cancellable.id } }),
    ).toMatchObject({
      state: BackgroundJobState.CANCELLED,
      cancellationRequested: true,
    });
    expect(
      await database.auditEvent.findMany({
        where: { action: { startsWith: "job." } },
        select: { action: true },
      }),
    ).toEqual(expect.arrayContaining([{ action: "job.retry-failed" }, { action: "job.cancel" }]));
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

async function authenticatedOtherWorkspace() {
  const suffix = randomUUID().slice(0, 8);
  const username = `other-${suffix}`;
  const password = "Other-Workspace-Password-2026!";
  const passwordHash = await new PasswordService().hash(password);
  const user = await database.user.create({
    data: {
      username,
      usernameCanonical: canonicalizeIdentity(username),
      email: `${username}@example.com`,
      emailCanonical: canonicalizeIdentity(`${username}@example.com`),
      displayName: "Other User",
      passwordHash,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      workspace: { create: {} },
    },
    include: { workspace: true },
  });
  if (!user.workspace) throw new Error("Other workspace was not created.");
  const agent = supertest.agent(app.getHttpServer());
  await agent
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .send({ identifier: username, password })
    .expect(200);
  return { agent, workspaceId: user.workspace.id };
}

async function drainWorker() {
  const workerDatabase = { client: database } as WorkerDatabaseService;
  const runner = new ImportExportRunner(
    workerDatabase,
    new WorkerRuntimeConfigService(workerDatabase),
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await runner.runOnce())) break;
  }
}

async function archiveMarkdownPaths(jobId: string): Promise<string[]> {
  const artifact = await database.exportArtifact.findUniqueOrThrow({ where: { jobId } });
  const extracted = await extractMarkdownZip(
    artifact.filePath,
    privatePath(temporaryRoot, "verify", `job_${jobId.replaceAll("-", "")}`),
    {
      maxFiles: 10,
      maxTotalBytes: 1024 * 1024,
      maxEntryBytes: 1024 * 1024,
      maxCompressionRatio: 1000,
      maxDepth: 8,
    },
  );
  return extracted.entries.map(({ relativePath }) => relativePath);
}

function binaryParser(
  response: IncomingMessage,
  callback: (error: Error | null, body?: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer | string) =>
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
  );
  response.on("end", () => callback(null, Buffer.concat(chunks)));
  response.on("error", (error) => callback(error));
}
