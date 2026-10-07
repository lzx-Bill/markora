import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "./database.service.js";
import { LoginAttemptCleanupRunner } from "./login-attempt-cleanup.runner.js";

describe("LoginAttemptCleanupRunner", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("deletes one bounded, lock-safe batch after the full window expires at most once per minute", async () => {
    vi.stubEnv("PUBLIC_ORIGIN", "http://localhost:27184");
    vi.stubEnv("DATABASE_URL", "postgresql://markora:markora@localhost:5432/markora");
    vi.stubEnv("SESSION_SECRET", "test-session-secret-that-is-long-enough");
    vi.stubEnv("LOGIN_WINDOW_SECONDS", "600");
    vi.stubEnv("DELETE_BATCH_SIZE", "7");
    const executeRaw = vi.fn().mockResolvedValue(7);
    const runner = new LoginAttemptCleanupRunner({
      client: { $executeRaw: executeRaw },
    } as unknown as DatabaseService);
    const now = new Date("2026-10-07T12:00:00.000Z");

    await expect(runner.runMaintenanceOnce(now)).resolves.toBe(7);
    await expect(runner.runMaintenanceOnce(new Date(now.getTime() + 59_999))).resolves.toBe(0);
    await expect(runner.runMaintenanceOnce(new Date(now.getTime() + 60_000))).resolves.toBe(7);

    const [query] = executeRaw.mock.calls[0] as unknown as [{ text: string; values: unknown[] }];
    expect(query.text).toContain('"window_start" <= $1');
    expect(query.text).toContain('ORDER BY "window_start" ASC, "id" ASC');
    expect(query.text).toContain("LIMIT $2");
    expect(query.text).toContain("FOR UPDATE SKIP LOCKED");
    expect(query.text).toContain('DELETE FROM "login_attempts"');
    expect(query.values).toEqual([new Date("2026-10-07T11:50:00.000Z"), 7]);
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });
});
