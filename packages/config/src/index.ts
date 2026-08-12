import { z } from "zod";

const PortSchema = z.coerce.number().int().min(1).max(65535);

export const ServerConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUBLIC_ORIGIN: z.url(),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: PortSchema.default(27184),
  DATABASE_URL: z.url().startsWith("postgresql://"),
  SESSION_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  TEMP_ROOT: z.string().min(1).default("./tmp"),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

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
