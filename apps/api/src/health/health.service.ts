import type { HealthResponse } from "@markora/contracts";
import { CURRENT_MIGRATION } from "@markora/database";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { CodedHttpException } from "../http/coded-http.exception.js";

@Injectable()
export class HealthService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  public liveness(): HealthResponse {
    return {
      status: "ok",
      service: "api",
      version: process.env.MARKORA_VERSION ?? process.env.npm_package_version ?? "0.0.0",
      timestamp: new Date().toISOString(),
    };
  }

  public async readiness(): Promise<HealthResponse> {
    const rows = await this.database.client.$queryRaw<
      Array<{ currentApplied: boolean; unfinishedCount: bigint }>
    >`
      SELECT
        EXISTS (
          SELECT 1
          FROM "_prisma_migrations"
          WHERE migration_name = ${CURRENT_MIGRATION}
            AND finished_at IS NOT NULL
            AND rolled_back_at IS NULL
        ) AS "currentApplied",
        COUNT(*) FILTER (
          WHERE finished_at IS NULL AND rolled_back_at IS NULL
        ) AS "unfinishedCount"
      FROM "_prisma_migrations"
    `;
    const state = rows[0];
    if (!state?.currentApplied || state.unfinishedCount > 0n) {
      throw new CodedHttpException(
        "DEPENDENCY_UNAVAILABLE",
        `Database migration ${CURRENT_MIGRATION} is not fully applied.`,
        503,
      );
    }
    return this.liveness();
  }
}
