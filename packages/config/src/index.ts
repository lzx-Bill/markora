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
  WORKSPACE_MAX_DEPTH: z.coerce.number().int().min(1).max(128).default(32),
  WORKSPACE_NAME_MAX_CODE_POINTS: z.coerce.number().int().min(32).max(255).default(255),
  DOCUMENT_MAX_BYTES: z.coerce.number().int().min(1024).default(5_242_880),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

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
  return result.data;
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
