import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BackgroundJobType,
  createDatabaseClient,
  type DatabaseClient,
  type Prisma,
  UserRole,
  UserStatus,
} from "../../../database/src/index.js";
import type { Principal, SearchQuery } from "../../../packages/contracts/src/index.js";
import { privatePath } from "../../../packages/portability/src/index.js";
import { ContentRepository } from "../../api/src/content/content.repository.js";
import { ContentService } from "../../api/src/content/content.service.js";
import type { DatabaseService as ApiDatabaseService } from "../../api/src/database/database.service.js";
import { RuntimeConfigService as ApiRuntimeConfigService } from "../../api/src/runtime-config/runtime-config.service.js";
import { PostgresSearchProvider } from "../../api/src/search/postgres-search.provider.js";
import type { DatabaseService as WorkerDatabaseService } from "../src/database.service.js";
import { ImportExportRunner } from "../src/import-export.runner.js";
import { RuntimeConfigService as WorkerRuntimeConfigService } from "../src/runtime-config.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString?.includes("markora_test")) {
  throw new Error("Release benchmark requires DATABASE_URL to target markora_test.");
}

const temporaryRoot = resolve("tmp/release-benchmark");
Object.assign(process.env, {
  NODE_ENV: "test",
  PUBLIC_ORIGIN: "http://localhost:27183",
  API_HOST: "127.0.0.1",
  API_PORT: "27184",
  SESSION_SECRET: "release-benchmark-secret-at-least-32-characters",
  DATABASE_URL: connectionString,
  TEMP_ROOT: temporaryRoot,
  ARGON2_MEMORY_KIB: "19456",
  ARGON2_TIME_COST: "2",
  ARGON2_PARALLELISM: "1",
  LOG_LEVEL: "error",
});

const database = createDatabaseClient(connectionString);
const benchmarkUsername = `release-benchmark-${randomUUID()}`;
let workspaceId: string | undefined;
let userId: string | undefined;

const budgets = {
  treeP95Ms: 500,
  documentOpenP95Ms: 2_000,
  concurrentSaveP95Ms: 1_000,
  searchP95Ms: 500,
  jobListP95Ms: 200,
  import300Ms: 30_000,
  export300Ms: 10_000,
};

describe("Phase 8 release performance gate", () => {
  it("meets the recorded representative workload budgets", async () => {
    try {
      await rm(temporaryRoot, { recursive: true, force: true });
      await mkdir(temporaryRoot, { recursive: true });
      await database.$executeRaw`TRUNCATE TABLE "audit_events"`;
      const staleUsers = await database.user.findMany({
        where: { username: { startsWith: "release-benchmark-" } },
        select: { id: true },
      });
      const staleUserIds = staleUsers.map(({ id }) => id);
      if (staleUserIds.length > 0) {
        await database.workspace.deleteMany({ where: { ownerUserId: { in: staleUserIds } } });
        await database.user.deleteMany({ where: { id: { in: staleUserIds } } });
      }
      const user = await database.user.create({
        data: {
          username: benchmarkUsername,
          usernameCanonical: benchmarkUsername,
          email: `${benchmarkUsername}@example.com`,
          emailCanonical: `${benchmarkUsername}@example.com`,
          displayName: "Release Benchmark",
          passwordHash: "not-used-by-benchmark",
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          workspace: { create: {} },
        },
        include: { workspace: true },
      });
      if (!user.workspace) throw new Error("Benchmark workspace was not created.");
      workspaceId = user.workspace.id;
      userId = user.id;

      await database.$executeRaw`
    INSERT INTO folders (id, workspace_id, name, normalized_name, state, created_at, updated_at)
    SELECT gen_random_uuid(), ${workspaceId}::uuid,
      'Folder ' || lpad(value::text, 5, '0'),
      'folder ' || lpad(value::text, 5, '0'),
      'ACTIVE', now(), now()
    FROM generate_series(1, 10000) value
  `;
      await database.$executeRaw`
    INSERT INTO documents (
      id, workspace_id, name, normalized_name, markdown, revision, state, created_at, updated_at
    )
    SELECT gen_random_uuid(), ${workspaceId}::uuid,
      'Document ' || lpad(value::text, 5, '0') || '.md',
      'document ' || lpad(value::text, 5, '0') || '.md',
      CASE WHEN value = 1
        THEN '# 性能基准' || E'\n分布式性能基准与恢复。'
        ELSE '# Benchmark ' || value || E'\nordinary searchable release content'
      END,
      1, 'ACTIVE', now(), now()
    FROM generate_series(1, 10000) value
  `;

      const apiDatabase = { client: database } as ApiDatabaseService;
      const repository = new ContentRepository();
      Object.assign(repository, { database: apiDatabase });
      const content = new ContentService();
      Object.assign(content, {
        database: apiDatabase,
        repository,
        runtimeConfig: Object.assign(new ApiRuntimeConfigService(), { database: apiDatabase }),
      });
      const search = new PostgresSearchProvider();
      Object.assign(search, { database: apiDatabase });
      const principal: Principal = {
        userId,
        workspaceId,
        sessionId: randomUUID(),
        username: benchmarkUsername,
        email: `${benchmarkUsername}@example.com`,
        displayName: "Release Benchmark",
        role: "ADMIN",
        mustChangePassword: false,
      };

      const treeLatencies = await sample(20, async () => {
        const tree = await content.folderTree(principal);
        if (tree.data.length !== 10_000) throw new Error("10k tree fixture was incomplete.");
      });

      const normalMarkdown = `${"x".repeat(1024 * 1024 - 32)}\nnormal document`;
      const normalDocument = await database.document.create({
        data: {
          workspaceId,
          name: "Maximum normal document.md",
          normalizedName: "maximum normal document.md",
          markdown: normalMarkdown,
        },
      });
      const openLatencies = await sample(20, async () => {
        const opened = await content.getDocument(principal, normalDocument.id);
        if (opened.markdown.length !== normalMarkdown.length)
          throw new Error("Document open truncated.");
      });

      const saveDocuments = await database.document.findMany({
        where: { workspaceId, name: { startsWith: "Document " } },
        orderBy: { name: "asc" },
        skip: 100,
        take: 20,
      });
      const saveLatencies: number[] = [];
      for (let round = 0; round < 20; round += 1) {
        const startedAt = performance.now();
        await Promise.all(
          saveDocuments.map((document) =>
            content.saveDocumentContent(
              principal,
              document.id,
              {
                markdown: `# Concurrent save ${round}\n${document.id}`,
                baseRevision: round + 1,
                clientMutationId: randomUUID(),
              },
              `benchmark-save-${round}-${document.id}`,
            ),
          ),
        );
        saveLatencies.push(performance.now() - startedAt);
      }

      const searchQuery: SearchQuery = {
        q: "分布式性能基准",
        scope: "all",
        includeCodeBlocks: false,
        limit: 50,
      };
      const searchLatencies = await sample(40, async () => {
        const result = await search.search(workspaceId as string, searchQuery, 0);
        if (result.data[0]?.name !== "Document 00001.md") {
          throw new Error("Representative CJK result did not rank first.");
        }
      });

      await database.backgroundJob.createMany({
        data: Array.from({ length: 1_000 }, (_, index) => ({
          workspaceId: workspaceId as string,
          ownerUserId: userId as string,
          type: index % 2 === 0 ? BackgroundJobType.IMPORT : BackgroundJobType.EXPORT,
          targetType: "export",
          targetId: workspaceId as string,
          state: "SUCCEEDED",
          progress: 100,
          completedAt: new Date(),
        })),
      });
      const jobLatencies = await sample(40, async () => {
        const jobs = await database.backgroundJob.findMany({
          where: { workspaceId },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { _count: { select: { items: true } } },
        });
        if (jobs.length !== 50) throw new Error("Job UI query did not return one page.");
      });

      const workerDatabase = { client: database } as WorkerDatabaseService;
      const runner = new ImportExportRunner(
        workerDatabase,
        new WorkerRuntimeConfigService(workerDatabase),
      );
      const importDurationMs = await benchmarkImport300(database, runner, workspaceId, userId);
      const exportDurationMs = await benchmarkExport300(database, runner, workspaceId, userId);

      const results = {
        generatedAt: new Date().toISOString(),
        environment: {
          platform: `${platform()} ${release()}`,
          node: process.version,
          cpu: cpus()[0]?.model ?? "unknown",
          logicalCpus: cpus().length,
          memoryGiB: Number((totalmem() / 1024 ** 3).toFixed(2)),
          freeMemoryGiBAtEnd: Number((freemem() / 1024 ** 3).toFixed(2)),
          database: (
            await database.$queryRaw<Array<{ version: string }>>`SELECT version() AS version`
          )[0]?.version,
        },
        shape: {
          folders: 10_000,
          documents: 10_001,
          concurrentSaves: 20,
          jobRows: 1_000,
          importDocuments: 300,
          exportDocuments: 300,
        },
        budgets,
        results: {
          tree: percentiles(treeLatencies),
          documentOpen: percentiles(openLatencies),
          concurrentSaveBatch: percentiles(saveLatencies),
          search: percentiles(searchLatencies),
          jobList: percentiles(jobLatencies),
          import300Ms: round(importDurationMs),
          export300Ms: round(exportDurationMs),
        },
      };
      const failures = [
        ["tree p95", results.results.tree.p95, budgets.treeP95Ms],
        ["document open p95", results.results.documentOpen.p95, budgets.documentOpenP95Ms],
        ["20-save batch p95", results.results.concurrentSaveBatch.p95, budgets.concurrentSaveP95Ms],
        ["search p95", results.results.search.p95, budgets.searchP95Ms],
        ["job list p95", results.results.jobList.p95, budgets.jobListP95Ms],
        ["300-document import", results.results.import300Ms, budgets.import300Ms],
        ["300-document export", results.results.export300Ms, budgets.export300Ms],
      ].filter(([, actual, budget]) => (actual as number) >= (budget as number));
      process.stdout.write(
        `${JSON.stringify({ ...results, passed: failures.length === 0, failures }, null, 2)}\n`,
      );
      expect(failures).toEqual([]);
    } finally {
      await database.$executeRaw`TRUNCATE TABLE "audit_events"`;
      if (workspaceId) await database.workspace.deleteMany({ where: { id: workspaceId } });
      if (userId) await database.user.deleteMany({ where: { id: userId } });
      await database.$disconnect();
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 120_000);
});

async function benchmarkImport300(
  database: DatabaseClient,
  runner: ImportExportRunner,
  workspaceId: string,
  userId: string,
): Promise<number> {
  const uploadDirectory = privatePath(temporaryRoot, "imports", `upload_${randomUUID()}`);
  const planDirectory = `plan_${randomUUID().replaceAll("-", "")}`;
  await mkdir(resolve(uploadDirectory, planDirectory), { recursive: true });
  const entries = await Promise.all(
    Array.from({ length: 300 }, async (_, index) => {
      const name = `Imported ${String(index + 1).padStart(3, "0")}.md`;
      const bytes = Buffer.from(`# Imported ${index + 1}\nportable benchmark`, "utf8");
      const sourceKey = createHash("sha256").update(name).digest("hex");
      const storageRelativePath = `${planDirectory}/${sourceKey}.md`;
      await writeFile(resolve(uploadDirectory, storageRelativePath), bytes);
      return {
        sourceKey,
        payload: {
          sourceKey,
          sourcePath: name,
          targetPath: name,
          directoryNames: [],
          documentName: name,
          storageRelativePath,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
          status: "READY",
          strategy: "KEEP_BOTH",
        } satisfies Prisma.InputJsonValue,
      };
    }),
  );
  const upload = await database.importUpload.create({
    data: {
      workspaceId,
      ownerUserId: userId,
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      tempPath: uploadDirectory,
      manifestHash: createHash("sha256").update("release-import").digest("hex"),
      manifest: { entries: [] },
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  const plan = await database.importPlan.create({
    data: {
      uploadId: upload.id,
      workspaceId,
      ownerUserId: userId,
      manifestHash: createHash("sha256").update("release-plan").digest("hex"),
      preview: {},
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  const job = await database.backgroundJob.create({
    data: {
      workspaceId,
      ownerUserId: userId,
      type: BackgroundJobType.IMPORT,
      targetType: "import-plan",
      targetId: plan.id,
      payload: {},
      checkpoint: { completed: 0, total: 300, currentItem: null, phase: "queued" },
      items: { create: entries },
    },
  });
  await database.importPlan.update({ where: { id: plan.id }, data: { executedJobId: job.id } });
  const startedAt = performance.now();
  for (let item = 0; item <= 300; item += 1) await runner.runOnce();
  const duration = performance.now() - startedAt;
  const completed = await database.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
  if (completed.state !== "SUCCEEDED") throw new Error(`300-document import: ${completed.state}`);
  return duration;
}

async function benchmarkExport300(
  database: DatabaseClient,
  runner: ImportExportRunner,
  workspaceId: string,
  userId: string,
): Promise<number> {
  const documents = await database.document.findMany({
    where: { workspaceId, name: { startsWith: "Imported " } },
    orderBy: { name: "asc" },
    take: 300,
  });
  const job = await database.backgroundJob.create({
    data: {
      workspaceId,
      ownerUserId: userId,
      type: BackgroundJobType.EXPORT,
      targetType: "export",
      targetId: workspaceId,
      payload: { downloadExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString() },
      checkpoint: { completed: 0, total: 300, currentItem: null, phase: "queued" },
      items: {
        create: documents.map((document) => ({
          sourceKey: document.id,
          payload: { archivePath: document.name },
        })),
      },
      exportManifest: {
        create: {
          scope: "workspace",
          report: { normalized: [] },
          items: {
            create: documents.map((document) => ({
              sourceDocumentId: document.id,
              displayPath: document.name,
              archivePath: document.name,
              markdown: document.markdown,
              sourceRevision: document.revision,
            })),
          },
        },
      },
    },
  });
  const startedAt = performance.now();
  await runner.runOnce();
  const duration = performance.now() - startedAt;
  const completed = await database.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
  if (completed.state !== "SUCCEEDED") throw new Error(`300-document export: ${completed.state}`);
  return duration;
}

async function sample(iterations: number, action: () => Promise<void>): Promise<number[]> {
  await action();
  const values: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    await action();
    values.push(performance.now() - startedAt);
  }
  return values;
}

function percentiles(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(values: readonly number[], fraction: number): number {
  return round(values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)] ?? 0);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
