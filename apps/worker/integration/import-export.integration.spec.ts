import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
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
import { extractMarkdownZip, privatePath } from "@markora/portability";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/database.service.js";
import { ImportExportRunner } from "../src/import-export.runner.js";
import { RuntimeConfigService } from "../src/runtime-config.service.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("markora_test")) {
  throw new Error("Phase 6 worker integration tests require DATABASE_URL to target markora_test.");
}

const temporaryRoot = resolve("tmp/worker-phase-6");
Object.assign(process.env, {
  NODE_ENV: "test",
  PUBLIC_ORIGIN: "http://localhost:27183",
  API_HOST: "127.0.0.1",
  API_PORT: "27184",
  SESSION_SECRET: "phase-six-worker-secret-at-least-32-characters",
  DATABASE_URL: databaseUrl,
  TEMP_ROOT: temporaryRoot,
  JOB_LEASE_SECONDS: "5",
  WORKER_POLL_MS: "1000",
});

let database: DatabaseClient;

beforeAll(() => {
  database = createDatabaseClient(databaseUrl);
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
  await rm(temporaryRoot, { recursive: true, force: true });
  await database.$disconnect();
});

describe("Phase 6 restart-safe import and export", () => {
  it("reclaims an expired item lease and atomically protects a Replace version", async () => {
    const { userId, workspaceId } = await createOwner();
    const document = await database.document.create({
      data: {
        workspaceId,
        name: "Existing.md",
        normalizedName: "existing.md",
        markdown: "old bytes",
      },
    });
    const source = Buffer.from("new bytes\r\n原样", "utf8");
    const sourceKey = createHash("sha256").update("Existing.md").digest("hex");
    const { planId, storageRelativePath } = await createPlan(
      workspaceId,
      userId,
      sourceKey,
      source,
    );
    const job = await database.backgroundJob.create({
      data: {
        workspaceId,
        ownerUserId: userId,
        type: BackgroundJobType.IMPORT,
        targetType: "import-plan",
        targetId: planId,
        state: BackgroundJobState.RUNNING,
        leaseOwner: "dead-worker",
        leaseExpiresAt: new Date(Date.now() - 60_000),
        items: {
          create: {
            sourceKey,
            state: JobItemState.RUNNING,
            payload: importPayload(sourceKey, source, storageRelativePath, "REPLACE"),
          },
        },
      },
    });

    expect(await runnerFor(database).runOnce()).toBe(true);

    expect(await database.document.findUniqueOrThrow({ where: { id: document.id } })).toMatchObject(
      { markdown: "new bytes\r\n原样", revision: 2 },
    );
    expect(
      await database.documentVersion.findFirstOrThrow({ where: { documentId: document.id } }),
    ).toMatchObject({ markdown: "old bytes", reason: "IMPORT_REPLACE", sourceRevision: 1 });
    expect(await database.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject(
      { state: BackgroundJobState.SUCCEEDED, progress: 100, attempts: 1 },
    );
    expect(await database.jobItem.findFirstOrThrow({ where: { jobId: job.id } })).toMatchObject({
      state: JobItemState.SUCCEEDED,
      attempts: 1,
    });

    const keepBothJob = await database.backgroundJob.create({
      data: {
        workspaceId,
        ownerUserId: userId,
        type: BackgroundJobType.IMPORT,
        targetType: "import-plan",
        targetId: planId,
        items: {
          create: {
            sourceKey,
            payload: importPayload(sourceKey, source, storageRelativePath, "KEEP_BOTH"),
          },
        },
      },
    });
    await runnerFor(database).runOnce();
    expect(
      await database.document.findFirstOrThrow({
        where: { workspaceId, normalizedName: "existing (2).md" },
      }),
    ).toMatchObject({ name: "Existing (2).md", markdown: "new bytes\r\n原样" });
    expect(
      await database.jobItem.findFirstOrThrow({ where: { jobId: keepBothJob.id } }),
    ).toMatchObject({ state: JobItemState.SUCCEEDED, result: { action: "KEPT_BOTH" } });

    const skipJob = await database.backgroundJob.create({
      data: {
        workspaceId,
        ownerUserId: userId,
        type: BackgroundJobType.IMPORT,
        targetType: "import-plan",
        targetId: planId,
        items: {
          create: {
            sourceKey,
            payload: importPayload(sourceKey, source, storageRelativePath, "SKIP"),
          },
        },
      },
    });
    await runnerFor(database).runOnce();
    expect(await database.document.count({ where: { workspaceId } })).toBe(2);
    expect(await database.jobItem.findFirstOrThrow({ where: { jobId: skipJob.id } })).toMatchObject(
      {
        state: JobItemState.SKIPPED,
        result: { reason: "NAME_CONFLICT" },
      },
    );
  });

  it("reports exact partial totals and a retry-safe failed item without duplicate writes", async () => {
    const { userId, workspaceId } = await createOwner();
    const source = Buffer.from("created once", "utf8");
    const sourceKey = createHash("sha256").update("Created.md").digest("hex");
    const { planId, storageRelativePath } = await createPlan(
      workspaceId,
      userId,
      sourceKey,
      source,
    );
    const job = await database.backgroundJob.create({
      data: {
        workspaceId,
        ownerUserId: userId,
        type: BackgroundJobType.IMPORT,
        targetType: "import-plan",
        targetId: planId,
        items: {
          create: [
            {
              sourceKey,
              payload: importPayload(
                sourceKey,
                source,
                storageRelativePath,
                "KEEP_BOTH",
                "Created.md",
              ),
            },
            {
              sourceKey: createHash("sha256").update("Missing.md").digest("hex"),
              payload: importPayload(
                createHash("sha256").update("Missing.md").digest("hex"),
                Buffer.from("missing"),
                "plan_missing/missing.md",
                "KEEP_BOTH",
                "Missing.md",
              ),
            },
          ],
        },
      },
    });
    const runner = runnerFor(database);
    await runner.runOnce();
    await runner.runOnce();
    const completed = await database.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(completed).toMatchObject({
      state: BackgroundJobState.SUCCEEDED_WITH_ISSUES,
      progress: 100,
      result: { total: 2, succeeded: 1, skipped: 0, failed: 1 },
    });
    expect(await database.document.count({ where: { workspaceId, name: "Created.md" } })).toBe(1);
    expect(
      await database.jobItem.findFirstOrThrow({ where: { jobId: job.id, state: "FAILED" } }),
    ).toMatchObject({
      errorCode: "IMPORT_ITEM_FAILED",
      result: { reason: "Import item could not be applied." },
    });
  });

  it("rejects an import target whose active row is hidden by a trashed ancestor", async () => {
    const { userId, workspaceId } = await createOwner();
    const parent = await database.folder.create({
      data: { workspaceId, name: "Hidden", normalizedName: "hidden" },
    });
    const target = await database.folder.create({
      data: {
        workspaceId,
        parentId: parent.id,
        name: "Target",
        normalizedName: "target",
      },
    });
    const source = Buffer.from("must not be imported", "utf8");
    const sourceKey = createHash("sha256").update("Blocked.md").digest("hex");
    const { planId, storageRelativePath } = await createPlan(
      workspaceId,
      userId,
      sourceKey,
      source,
      target.id,
    );
    await database.folder.update({
      where: { id: parent.id },
      data: { state: "TRASHED", deletedAt: new Date() },
    });
    const job = await database.backgroundJob.create({
      data: {
        workspaceId,
        ownerUserId: userId,
        type: BackgroundJobType.IMPORT,
        targetType: "import-plan",
        targetId: planId,
        items: {
          create: {
            sourceKey,
            payload: importPayload(
              sourceKey,
              source,
              storageRelativePath,
              "KEEP_BOTH",
              "Blocked.md",
            ),
          },
        },
      },
    });

    await runnerFor(database).runOnce();

    expect(await database.document.count({ where: { workspaceId } })).toBe(0);
    expect(await database.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject(
      {
        state: BackgroundJobState.SUCCEEDED_WITH_ISSUES,
        result: { total: 1, succeeded: 0, skipped: 0, failed: 1 },
      },
    );
  });

  it("archives the immutable manifest snapshot and expires its private artifact", async () => {
    const { userId, workspaceId } = await createOwner();
    const document = await database.document.create({
      data: {
        workspaceId,
        name: "Live.md",
        normalizedName: "live.md",
        markdown: "changed after snapshot",
        revision: 2,
      },
    });
    const job = await database.backgroundJob.create({
      data: {
        workspaceId,
        ownerUserId: userId,
        type: BackgroundJobType.EXPORT,
        targetType: "export",
        targetId: workspaceId,
        payload: { downloadExpiresAt: new Date(Date.now() + 60_000).toISOString() },
        exportManifest: {
          create: {
            scope: "workspace",
            report: {},
            items: {
              create: {
                sourceDocumentId: document.id,
                displayPath: "Live.md",
                archivePath: "Live.md",
                markdown: "snapshot bytes\r\n原样",
                sourceRevision: 1,
              },
            },
          },
        },
        items: { create: { sourceKey: document.id, payload: { archivePath: "Live.md" } } },
      },
    });
    const runner = runnerFor(database);
    await runner.runOnce();
    const artifact = await database.exportArtifact.findUniqueOrThrow({ where: { jobId: job.id } });
    const extracted = await extractMarkdownZip(
      artifact.filePath,
      privatePath(temporaryRoot, "verify", `job_${job.id.replaceAll("-", "")}`),
      {
        maxFiles: 10,
        maxTotalBytes: 1024 * 1024,
        maxEntryBytes: 1024 * 1024,
        maxCompressionRatio: 1000,
        maxDepth: 8,
      },
    );
    expect(await readFile(extracted.entries[0]?.storagePath ?? "", "utf8")).toBe(
      "snapshot bytes\r\n原样",
    );
    await database.exportArtifact.update({
      where: { id: artifact.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const orphanImport = privatePath(temporaryRoot, "imports", `upload_${randomUUID()}`);
    const orphanExport = privatePath(
      temporaryRoot,
      "exports",
      `job_${randomUUID().replaceAll("-", "")}`,
    );
    await mkdir(orphanImport, { recursive: true });
    await mkdir(orphanExport, { recursive: true });
    const old = new Date(Date.now() - 3 * 60 * 60_000);
    await utimes(orphanImport, old, old);
    await utimes(orphanExport, old, old);
    await runner.runMaintenanceOnce();
    expect(await database.exportArtifact.count({ where: { id: artifact.id } })).toBe(0);
    await expect(readFile(artifact.filePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(orphanImport)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(orphanExport)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function runnerFor(client: DatabaseClient): ImportExportRunner {
  const database = { client } as DatabaseService;
  return new ImportExportRunner(database, new RuntimeConfigService(database));
}

async function createOwner() {
  const suffix = randomUUID().slice(0, 8);
  const user = await database.user.create({
    data: {
      username: `portability-${suffix}`,
      usernameCanonical: `portability-${suffix}`,
      email: `portability-${suffix}@example.com`,
      emailCanonical: `portability-${suffix}@example.com`,
      displayName: "Portability Owner",
      passwordHash: "not-used-in-worker-test",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      workspace: { create: {} },
    },
    include: { workspace: true },
  });
  if (!user.workspace) throw new Error("Workspace was not created.");
  return { userId: user.id, workspaceId: user.workspace.id };
}

async function createPlan(
  workspaceId: string,
  userId: string,
  sourceKey: string,
  source: Buffer,
  targetFolderId: string | null = null,
) {
  const uploadDirectory = privatePath(temporaryRoot, "imports", `upload_${randomUUID()}`);
  const planDirectory = `plan_${randomUUID().replaceAll("-", "")}`;
  await mkdir(resolve(uploadDirectory, planDirectory), { recursive: true });
  const storageRelativePath = `${planDirectory}/${sourceKey}.md`;
  await writeFile(resolve(uploadDirectory, storageRelativePath), source);
  const upload = await database.importUpload.create({
    data: {
      workspaceId,
      ownerUserId: userId,
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      tempPath: uploadDirectory,
      manifestHash: createHash("sha256").update(source).digest("hex"),
      manifest: { entries: [] },
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const plan = await database.importPlan.create({
    data: {
      uploadId: upload.id,
      workspaceId,
      ownerUserId: userId,
      targetFolderId,
      manifestHash: createHash("sha256").update(sourceKey).digest("hex"),
      preview: {},
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return { planId: plan.id, storageRelativePath };
}

function importPayload(
  sourceKey: string,
  bytes: Buffer,
  storageRelativePath: string,
  strategy: "KEEP_BOTH" | "SKIP" | "REPLACE",
  documentName = "Existing.md",
) {
  return {
    sourceKey,
    sourcePath: documentName,
    targetPath: documentName,
    directoryNames: [],
    documentName,
    storageRelativePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    status: "READY",
    strategy,
  };
}
