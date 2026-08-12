import { describe, expect, it } from "vitest";
import { ConfigValidationError, loadBootstrapConfig, loadServerConfig } from "./index.js";

const validEnvironment = {
  NODE_ENV: "test",
  PUBLIC_ORIGIN: "http://localhost:27180",
  DATABASE_URL: "postgresql://markora:markora@localhost:27185/markora",
  SESSION_SECRET: "a-development-only-secret-at-least-32-chars",
};

describe("loadServerConfig", () => {
  it("applies typed defaults", () => {
    const config = loadServerConfig(validEnvironment);
    expect(config.API_PORT).toBe(27184);
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.SESSION_TTL_DAYS).toBe(30);
    expect(config.WORKSPACE_MAX_DEPTH).toBe(32);
    expect(config.DOCUMENT_MAX_BYTES).toBe(5_242_880);
    expect(config.DOCUMENT_LARGE_BYTES).toBe(1_048_576);
    expect(config.DOCUMENT_LARGE_LINES).toBe(50_000);
    expect(config.VERSION_SNAPSHOT_INTERVAL_MINUTES).toBe(10);
  });

  it("fails fast without required secrets", () => {
    expect(() => loadServerConfig({ ...validEnvironment, SESSION_SECRET: "short" })).toThrow(
      ConfigValidationError,
    );
  });

  it("requires explicit bootstrap credentials", () => {
    expect(() => loadBootstrapConfig({})).toThrow(ConfigValidationError);
  });
});
