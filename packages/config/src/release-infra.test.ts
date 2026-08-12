import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const composePath = new URL("../../../infra/docker/compose.yaml", import.meta.url);
const dockerfilePath = new URL("../../../infra/docker/Dockerfile", import.meta.url);
const proxyPath = new URL("../../../infra/reverse-proxy/Caddyfile", import.meta.url);
const backupPath = new URL("../../../infra/scripts/backup.sh", import.meta.url);
const restorePath = new URL("../../../infra/scripts/restore.sh", import.meta.url);

describe("production release infrastructure", () => {
  it("keeps PostgreSQL private and gates services on migrations and readiness", async () => {
    const [compose, dockerfile] = await Promise.all([
      readFile(composePath, "utf8"),
      readFile(dockerfilePath, "utf8"),
    ]);
    const postgres = compose.slice(compose.indexOf("  postgres:"), compose.indexOf("  migrate:"));

    expect(postgres).not.toMatch(/\n\s+ports:/u);
    expect(compose).toContain("backend:\n    internal: true");
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("/api/v1/health/ready");
    expect(compose.match(/@sha256:/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(dockerfile).toMatch(/FROM node:24\.11\.1-alpine@sha256:[a-f0-9]{64}/u);
    expect(compose).not.toContain("redis");
  });

  it("sets immutable browser security headers and bounded request bodies", async () => {
    const proxy = await readFile(proxyPath, "utf8");

    for (const header of [
      "Strict-Transport-Security",
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(proxy).toContain(header);
    }
    expect(proxy).toContain("max_size 110MB");
    expect(proxy).toContain("X-Request-ID");
  });

  it("validates backups and refuses an accidental in-place restore", async () => {
    const [backup, restore] = await Promise.all([
      readFile(backupPath, "utf8"),
      readFile(restorePath, "utf8"),
    ]);

    expect(backup).toContain("pg_restore --list");
    expect(backup).toContain("sha256sum");
    expect(restore).toContain("sha256sum -c");
    expect(restore).toContain("refusing in-place restore");
    expect(restore).toContain("--exit-on-error");
  });
});
