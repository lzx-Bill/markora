import { createHmac } from "node:crypto";
import { loadServerConfig } from "@markora/config";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { CodedHttpException } from "../http/coded-http.exception.js";

@Injectable()
export class LoginRateLimitService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  private readonly config = loadServerConfig(process.env);

  public fingerprint(value: string): string {
    return createHmac("sha256", this.config.SESSION_SECRET).update(value).digest("hex");
  }

  public async assertAllowed(
    subjectHash: string,
    networkHash: string,
    now = new Date(),
  ): Promise<void> {
    const blocked = await this.database.client.loginAttempt.findFirst({
      where: { subjectHash, networkHash, blockedUntil: { gt: now } },
      select: { blockedUntil: true },
    });
    if (blocked) {
      throw new CodedHttpException(
        "RATE_LIMITED",
        "Too many login attempts. Try again later.",
        429,
      );
    }
  }

  public async recordFailure(
    subjectHash: string,
    networkHash: string,
    now = new Date(),
  ): Promise<void> {
    const windowMilliseconds = this.config.LOGIN_WINDOW_SECONDS * 1000;
    const windowStart = new Date(
      Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds,
    );
    const attempt = await this.database.client.loginAttempt.upsert({
      where: { subjectHash_networkHash_windowStart: { subjectHash, networkHash, windowStart } },
      create: { subjectHash, networkHash, windowStart, count: 1 },
      update: { count: { increment: 1 } },
    });
    if (attempt.count >= this.config.LOGIN_MAX_ATTEMPTS) {
      await this.database.client.loginAttempt.update({
        where: { id: attempt.id },
        data: { blockedUntil: new Date(windowStart.getTime() + windowMilliseconds) },
      });
    }
  }

  public async clear(subjectHash: string, networkHash: string): Promise<void> {
    await this.database.client.loginAttempt.deleteMany({ where: { subjectHash, networkHash } });
  }
}
