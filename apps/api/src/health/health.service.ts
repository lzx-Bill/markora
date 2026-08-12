import type { HealthResponse } from "@markora/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class HealthService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  public liveness(): HealthResponse {
    return {
      status: "ok",
      service: "api",
      version: process.env.npm_package_version ?? "0.0.0",
      timestamp: new Date().toISOString(),
    };
  }

  public async readiness(): Promise<HealthResponse> {
    await this.database.client.$queryRaw`SELECT 1`;
    return this.liveness();
  }
}
