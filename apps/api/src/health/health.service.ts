import { loadServerConfig } from "@markora/config";
import type { HealthResponse } from "@markora/contracts";
import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";

@Injectable()
export class HealthService implements OnApplicationShutdown {
  private readonly pool: Pool;

  public constructor() {
    const config = loadServerConfig(process.env);
    this.pool = new Pool({ connectionString: config.DATABASE_URL, max: 2 });
  }

  public liveness(): HealthResponse {
    return {
      status: "ok",
      service: "api",
      version: process.env.npm_package_version ?? "0.0.0",
      timestamp: new Date().toISOString(),
    };
  }

  public async readiness(): Promise<HealthResponse> {
    await this.pool.query("SELECT 1");
    return this.liveness();
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
