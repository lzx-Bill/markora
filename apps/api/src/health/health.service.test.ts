import { describe, expect, it, vi } from "vitest";
import { HealthService } from "./health.service.js";

describe("HealthService", () => {
  it("distinguishes process liveness from migration-aware readiness", async () => {
    const query = vi.fn().mockResolvedValue([{ currentApplied: true, unfinishedCount: 0n }]);
    const service = new HealthService();
    Object.assign(service, { database: { client: { $queryRaw: query } } });

    expect(service.liveness()).toMatchObject({ status: "ok", service: "api" });
    await expect(service.readiness()).resolves.toMatchObject({ status: "ok", service: "api" });

    query.mockResolvedValue([{ currentApplied: false, unfinishedCount: 1n }]);
    await expect(service.readiness()).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  });
});
