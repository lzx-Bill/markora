import { describe, expect, it } from "vitest";
import { BackgroundJobSchema, RestoreResourceRequestSchema, TrashListSchema } from "./recovery.js";

describe("Phase 4 recovery contracts", () => {
  it("defaults restore to fail closed and rejects unknown mutation fields", () => {
    expect(RestoreResourceRequestSchema.parse({})).toEqual({ conflictStrategy: "FAIL" });
    expect(() => RestoreResourceRequestSchema.parse({ overwrite: true })).toThrow();
  });

  it("requires bounded job progress and explicit Trash pagination", () => {
    expect(() =>
      BackgroundJobSchema.parse({
        id: "00000000-0000-4000-8000-000000000001",
        type: "PERMANENT_DELETE_DOCUMENT",
        state: "RUNNING",
        targetType: "document",
        targetId: "00000000-0000-4000-8000-000000000002",
        progress: 101,
        errorCode: null,
        createdAt: "2026-08-12T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
      }),
    ).toThrow();
    expect(TrashListSchema.parse({ data: [], retentionDays: 30, nextCursor: null })).toMatchObject({
      nextCursor: null,
    });
  });
});
