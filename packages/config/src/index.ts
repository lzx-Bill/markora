import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

const PortSchema = z.coerce.number().int().min(1).max(65535);

export const ServerConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUBLIC_ORIGIN: z.url(),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: PortSchema.default(27184),
  DATABASE_URL: z.url().startsWith("postgresql://"),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  LOGIN_WINDOW_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(19_456).default(65_536),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  TEMP_ROOT: z.string().min(1).default("./tmp"),
  MARKORA_ROOT: z.string().min(1).optional(),
  WORKSPACE_MAX_DEPTH: z.coerce.number().int().min(1).max(128).default(32),
  WORKSPACE_NAME_MAX_CODE_POINTS: z.coerce.number().int().min(32).max(255).default(255),
  DOCUMENT_MAX_BYTES: z.coerce.number().int().min(1024).default(5_242_880),
  DOCUMENT_LARGE_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
  DOCUMENT_LARGE_LINES: z.coerce.number().int().min(1000).default(50_000),
  VERSION_SNAPSHOT_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
  VERSION_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  TRASH_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  DELETE_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  JOB_LEASE_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
  WORKER_POLL_MS: z.coerce.number().int().min(100).max(60000).default(1000),
  JOB_ITEM_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
  IMPORT_UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).default(52_428_800),
  IMPORT_MAX_FILES: z.coerce.number().int().min(1).max(100_000).default(2_000),
  IMPORT_MAX_TOTAL_BYTES: z.coerce.number().int().min(1024).default(104_857_600),
  IMPORT_MAX_COMPRESSION_RATIO: z.coerce.number().min(1).max(10_000).default(100),
  IMPORT_UPLOAD_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  IMPORT_PLAN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  EXPORT_DOWNLOAD_TTL_MINUTES: z.coerce.number().int().min(5).max(10_080).default(60),
  EXPORT_PATH_MAX_BYTES: z.coerce.number().int().min(120).max(4096).default(240),
  TEMP_ORPHAN_AGE_MINUTES: z.coerce.number().int().min(5).max(10_080).default(120),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

const UploadStorageConfigSchema = ServerConfigSchema.pick({
  TEMP_ROOT: true,
  MARKORA_ROOT: true,
  IMPORT_MAX_FILES: true,
  IMPORT_UPLOAD_MAX_BYTES: true,
});

export type UploadStorageConfig = z.infer<typeof UploadStorageConfigSchema>;

export const BootstrapConfigSchema = z.object({
  BOOTSTRAP_ADMIN_USERNAME: z.string().trim().min(3).max(64),
  BOOTSTRAP_ADMIN_EMAIL: z.email(),
  BOOTSTRAP_ADMIN_DISPLAY_NAME: z.string().trim().min(1).max(100).default("Administrator"),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(1024),
});

export type BootstrapConfig = z.infer<typeof BootstrapConfigSchema>;

export class ConfigValidationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Invalid server configuration: ${issues.join("; ")}`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

export function loadServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const result = ServerConfigSchema.safeParse(environment);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const root = environment.MARKORA_ROOT ?? environment.INIT_CWD ?? process.cwd();
  return {
    ...result.data,
    TEMP_ROOT: isAbsolute(result.data.TEMP_ROOT)
      ? resolve(result.data.TEMP_ROOT)
      : resolve(root, result.data.TEMP_ROOT),
  };
}

export function loadUploadStorageConfig(environment: NodeJS.ProcessEnv): UploadStorageConfig {
  const result = UploadStorageConfigSchema.safeParse(environment);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const root = environment.MARKORA_ROOT ?? environment.INIT_CWD ?? process.cwd();
  return {
    ...result.data,
    TEMP_ROOT: isAbsolute(result.data.TEMP_ROOT)
      ? resolve(result.data.TEMP_ROOT)
      : resolve(root, result.data.TEMP_ROOT),
  };
}

export function loadBootstrapConfig(environment: NodeJS.ProcessEnv): BootstrapConfig {
  const result = BootstrapConfigSchema.safeParse(environment);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return result.data;
}
