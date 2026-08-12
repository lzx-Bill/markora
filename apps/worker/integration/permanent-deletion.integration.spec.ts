import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
  BackgroundJobState,
  BackgroundJobType,
  createDatabaseClient,
  type DatabaseClient,
  ResourceState,
  UserRole,
  UserStatus,
} from "@markora/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/database.service.js";
import { PermanentDeletionRunner } from "../src/permanent-deletion.runner.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.includes("markora_test")) {
  throw new Error("Phase 4 worker integration tests require DATABASE_URL to target markora_test.");
}

Object.assign(process.env, {
  NODE_ENV: "test",
  PUBLIC_ORIGIN: "http://localhost:27183",
  API_HOST: "127.0.0.1",
  API_PORT: "27184",
  SESSION_SECRET: "phase-four-worker-secret-at-least-32-characters",
  DATABASE_URL: databaseUrl,
  DELETE_BATCH_SIZE: "2",
  JOB_LEASE_SECONDS: "5",
  WORKER_POLL_MS: "1000",
});

let database: DatabaseClient;

beforeAll(() => {
  database = createDatabaseClient(databaseUrl);
});

beforeEach(async () => {
  await database.auditEvent.deleteMany();
  await database.loginAttempt.deleteMany();
  await database.session.deleteMany();
  await database.workspace.deleteMany();
  await database.user.deleteMany();
});

afterAll(async () => {
  await database.$disconnect();
});

describe("Phase 4 restart-safe permanent deletion", () => {
  it("reclaims an expired lease, processes bounded batches and removes a folder subtree", async () => {
    const { userId, workspaceId } = await createOwner();
    const root = await database.folder.create({
      data: {
        workspaceId,
        name: "Trash",
        normalizedName: "trash",
        state: ResourceState.DELETING,
        deletedAt: new Date(),
      },
    });
    const child = await database.folder.create({
      data: { workspaceId, parentId: root.id, name: "Child", normalizedName: "child" },
    });
    await database.document.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        workspaceId,
        folderId: child.id,
        name: `Doc ${index}.md`,
        normalizedName: `doc ${index}.md`,
      })),
    });
    const job = await database.backgroundJob.create({
      data: {
        workspaceId,
        ownerUserId: userId,
        type: BackgroundJobType.PERMANENT_DELETE_FOLDER,
        targetType: "folder",
        targetId: root.id,
        state: BackgroundJobState.RUNNING,
        leaseOwner: "dead-worker",
        leaseExpiresAt: new Date(Date.now() - 60_000),
        startedAt: new Date(Date.now() - 120_000),
      },
    });
    const runner = runnerFor(database);
    expect(await runner.runOnce()).toBe(true);
    expect(await database.document.count({ where: { workspaceId } })).toBe(3);
    expect(
      (await database.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).attempts,
    ).toBe(1);

    for (let step = 0; step < 10; step += 1) {
      await runner.runOnce();
      if (
        (await database.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).state ===
        BackgroundJobState.SUCCEEDED
      )
        break;
    }
    expect(await database.folder.count({ where: { workspaceId } })).toBe(0);
    expect(await database.document.count({ where: { workspaceId } })).toBe(0);
    expect(await database.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject(
      {
        state: BackgroundJobState.SUCCEEDED,
        progress: 100,
        errorCode: null,
      },
    );
  });

  it("removes document history in bounded batches before the document", async () => {
    const { userId, workspaceId } = await createOwner();
    const document = await database.document.create({
      data: {
        workspaceId,
        name: "Delete.md",
        normalizedName: "delete.md",
        state: ResourceState.DELETING,
        deletedAt: new Date(),
      },
    });
    await database.documentVersion.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        documentId: document.id,
        workspaceId,
        versionNo: index + 1,
        markdown: `v${index}`,
        documentName: document.name,
        reason: "AUTO_SAVE" as const,
        sourceRevision: index + 1,
        actorId: userId,
      })),
    });
    const job = await database.backgroundJob.create({
      data: {
        workspaceId,
        ownerUserId: userId,
        type: BackgroundJobType.PERMANENT_DELETE_DOCUMENT,
        targetType: "document",
        targetId: document.id,
      },
    });
    const runner = runnerFor(database);
    await runner.runOnce();
    expect(await database.documentVersion.count({ where: { documentId: document.id } })).toBe(3);
    expect(await database.document.count({ where: { id: document.id } })).toBe(1);
    for (let step = 0; step < 10; step += 1) await runner.runOnce();
    expect(await database.document.count({ where: { id: document.id } })).toBe(0);
    expect((await database.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe(
      BackgroundJobState.SUCCEEDED,
    );
  });

  it("prunes only expired routine versions and queues expired Trash roots", async () => {
    const { userId, workspaceId } = await createOwner();
    const document = await database.document.create({
      data: { workspaceId, name: "Policy.md", normalizedName: "policy.md" },
    });
    const old = new Date(Date.now() - 100 * 86_400_000);
    await database.documentVersion.createMany({
      data: [
        {
          documentId: document.id,
          workspaceId,
          versionNo: 1,
          markdown: "routine",
          documentName: document.name,
          reason: "AUTO_SAVE",
          sourceRevision: 1,
          actorId: userId,
          createdAt: old,
        },
        {
          documentId: document.id,
          workspaceId,
          versionNo: 2,
          markdown: "protected",
          documentName: document.name,
          reason: "RESTORE",
          sourceRevision: 2,
          actorId: userId,
          createdAt: old,
        },
      ],
    });
    const expired = await database.document.create({
      data: {
        workspaceId,
        name: "Expired.md",
        normalizedName: "expired.md",
        state: ResourceState.TRASHED,
        deletedAt: new Date(Date.now() - 31 * 86_400_000),
        originalFolderIsRoot: true,
      },
    });
    const runner = runnerFor(database);
    await runner.runMaintenanceOnce();
    expect(await database.documentVersion.findMany({ where: { documentId: document.id } })).toEqual(
      [expect.objectContaining({ reason: "RESTORE", markdown: "protected" })],
    );
    expect(await database.document.findUniqueOrThrow({ where: { id: expired.id } })).toMatchObject({
      state: ResourceState.DELETING,
    });
    expect(
      await database.backgroundJob.findFirstOrThrow({ where: { targetId: expired.id } }),
    ).toMatchObject({
      type: BackgroundJobType.PERMANENT_DELETE_DOCUMENT,
      state: BackgroundJobState.PENDING,
    });
  });
});

function runnerFor(client: DatabaseClient): PermanentDeletionRunner {
  return new PermanentDeletionRunner({ client } as DatabaseService);
}

async function createOwner() {
  const suffix = randomUUID().slice(0, 8);
  const user = await database.user.create({
    data: {
      username: `worker-${suffix}`,
      usernameCanonical: `worker-${suffix}`,
      email: `worker-${suffix}@example.com`,
      emailCanonical: `worker-${suffix}@example.com`,
      displayName: "Worker Owner",
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
