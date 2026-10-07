import { loadServerConfig } from "@markora/config";
import { Prisma } from "@markora/database";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";

const CLEANUP_INTERVAL_MS = 60_000;

@Injectable()
export class LoginAttemptCleanupRunner {
  private readonly config = loadServerConfig(process.env);
  private lastRunAt = Number.NEGATIVE_INFINITY;

  public constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  public async runMaintenanceOnce(now = new Date()): Promise<number> {
    if (now.getTime() - this.lastRunAt < CLEANUP_INTERVAL_MS) return 0;
    this.lastRunAt = now.getTime();
    const cutoff = new Date(now.getTime() - this.config.LOGIN_WINDOW_SECONDS * 1000);
    return this.database.client.$executeRaw(Prisma.sql`
      WITH expired AS (
        SELECT "id"
        FROM "login_attempts"
        WHERE "window_start" <= ${cutoff}
        ORDER BY "window_start" ASC, "id" ASC
        LIMIT ${this.config.DELETE_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "login_attempts" AS attempts
      USING expired
      WHERE attempts."id" = expired."id"
    `);
  }
}
