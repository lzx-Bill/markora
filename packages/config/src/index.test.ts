import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigValidationError,
  loadBootstrapConfig,
  loadServerConfig,
  loadUploadStorageConfig,
} from "./index.js";

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
    expect(config.IMPORT_MAX_FILES).toBe(2_000);
    expect(config.IMPORT_MAX_COMPRESSION_RATIO).toBe(100);
    expect(config.EXPORT_PATH_MAX_BYTES).toBe(240);
    expect(config.TEMP_ROOT).toMatch(/[\\/]tmp$/u);
  });

  it("resolves one shared relative temp root for package processes", () => {
    const root = resolve("markora-root");
    const config = loadServerConfig({
      ...validEnvironment,
      MARKORA_ROOT: root,
      TEMP_ROOT: "./private-temp",
    });
    expect(config.TEMP_ROOT).toBe(resolve(root, "private-temp"));
  });

  it("loads upload storage limits without unrelated service credentials", () => {
    const root = resolve("markora-root");
    expect(
      loadUploadStorageConfig({
        MARKORA_ROOT: root,
        TEMP_ROOT: "./private-temp",
        IMPORT_MAX_FILES: "12",
        IMPORT_UPLOAD_MAX_BYTES: "4096",
      }),
    ).toMatchObject({
      TEMP_ROOT: resolve(root, "private-temp"),
      IMPORT_MAX_FILES: 12,
      IMPORT_UPLOAD_MAX_BYTES: 4096,
    });
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
