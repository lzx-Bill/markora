import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@markora/config";
import type { Principal, SessionList } from "@markora/contracts";
import { AuditResult, UserStatus } from "@markora/database";
import { canonicalizeIdentity } from "@markora/domain";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { CodedHttpException } from "../http/coded-http.exception.js";
import { AuditService } from "./audit.service.js";
import { LoginRateLimitService } from "./login-rate-limit.service.js";
import { PasswordService } from "./password.service.js";
import { createOpaqueSessionToken, hashSessionToken } from "./session-token.js";

interface PrincipalSource {
  readonly sessionId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly username: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: "USER" | "ADMIN";
  readonly mustChangePassword: boolean;
}

export interface LoginResult {
  readonly principal: Principal;
  readonly token: string;
}

@Injectable()
export class AuthService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  @Inject(PasswordService)
  private readonly passwords!: PasswordService;

  @Inject(LoginRateLimitService)
  private readonly rateLimit!: LoginRateLimitService;

  @Inject(AuditService)
  private readonly audit!: AuditService;

  private readonly config = loadServerConfig(process.env);
  private dummyPasswordHash: Promise<string> | undefined;

  public async login(
    identifier: string,
    password: string,
    networkAddress: string,
    userAgent: string,
    requestId: string,
  ): Promise<LoginResult> {
    const canonicalIdentifier = canonicalizeIdentity(identifier);
    const subjectHash = this.rateLimit.fingerprint(canonicalIdentifier);
    const networkHash = this.rateLimit.fingerprint(networkAddress);
    await this.rateLimit.assertAllowed(subjectHash, networkHash);

    const user = await this.database.client.user.findFirst({
      where: {
        OR: [{ usernameCanonical: canonicalIdentifier }, { emailCanonical: canonicalIdentifier }],
      },
      include: { workspace: true },
    });

    this.dummyPasswordHash ??= this.passwords.hash("markora-dummy-password-never-used");
    const passwordHash = user?.passwordHash ?? (await this.dummyPasswordHash);
    const passwordValid = await this.passwords.verify(passwordHash, password);
    if (!user || !passwordValid || user.status !== UserStatus.ACTIVE || !user.workspace) {
      await this.rateLimit.recordFailure(subjectHash, networkHash);
      if (user?.status === UserStatus.DISABLED) {
        await this.database.client.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record({
        ...(user ? { actorUserId: user.id } : {}),
        ...(user?.workspace ? { workspaceId: user.workspace.id } : {}),
        action: "auth.login",
        targetType: "session",
        result: "FAILURE",
        requestId,
        metadata: { subjectHash, networkHash },
      });
      throw new CodedHttpException(
        "AUTHENTICATION_FAILED",
        "The username/email or password is incorrect.",
        401,
      );
    }

    const token = createOpaqueSessionToken();
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_DAYS * 86_400_000);
    const [session] = await this.database.client.$transaction([
      this.database.client.session.create({
        data: {
          userId: user.id,
          tokenHash: hashSessionToken(token),
          familyId: randomUUID(),
          userAgentSummary: sanitizeUserAgent(userAgent),
          expiresAt,
        },
      }),
      this.database.client.auditEvent.create({
        data: {
          actorUserId: user.id,
          workspaceId: user.workspace.id,
          action: "auth.login",
          targetType: "session",
          result: AuditResult.SUCCESS,
          requestId,
          metadata: { networkHash },
        },
      }),
    ]);
    await this.rateLimit.clear(subjectHash, networkHash);

    return {
      token,
      principal: principalFrom({
        sessionId: session.id,
        userId: user.id,
        workspaceId: user.workspace.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      }),
    };
  }

  public async authenticateSession(token: string): Promise<Principal | undefined> {
    const now = new Date();
    const session = await this.database.client.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: { include: { workspace: true } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.status !== UserStatus.ACTIVE ||
      !session.user.workspace
    ) {
      if (session && !session.revokedAt) {
        await this.database.client.session.update({
          where: { id: session.id },
          data: { revokedAt: now },
        });
      }
      return undefined;
    }

    if (now.getTime() - session.lastActiveAt.getTime() > 300_000) {
      await this.database.client.session.update({
        where: { id: session.id },
        data: { lastActiveAt: now },
      });
    }

    return principalFrom({
      sessionId: session.id,
      userId: session.user.id,
      workspaceId: session.user.workspace.id,
      username: session.user.username,
      email: session.user.email,
      displayName: session.user.displayName,
      role: session.user.role,
      mustChangePassword: session.user.mustChangePassword,
    });
  }

  public async logout(principal: Principal, requestId: string): Promise<void> {
    await this.database.client.$transaction([
      this.database.client.session.updateMany({
        where: { id: principal.sessionId, userId: principal.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.database.client.auditEvent.create({
        data: {
          actorUserId: principal.userId,
          workspaceId: principal.workspaceId,
          action: "auth.logout",
          targetType: "session",
          targetId: principal.sessionId,
          result: AuditResult.SUCCESS,
          requestId,
        },
      }),
    ]);
  }

  public async changePassword(
    principal: Principal,
    currentPassword: string,
    newPassword: string,
    requestId: string,
  ): Promise<void> {
    const user = await this.database.client.user.findUnique({ where: { id: principal.userId } });
    if (!user || !(await this.passwords.verify(user.passwordHash, currentPassword))) {
      await this.audit.record({
        actorUserId: principal.userId,
        workspaceId: principal.workspaceId,
        action: "account.password.change",
        targetType: "user",
        targetId: principal.userId,
        result: "FAILURE",
        requestId,
      });
      throw new CodedHttpException(
        "AUTHENTICATION_FAILED",
        "The current password is incorrect.",
        401,
      );
    }
    if (currentPassword === newPassword) {
      throw new CodedHttpException(
        "PASSWORD_POLICY_FAILED",
        "The new password must be different from the current password.",
        422,
      );
    }

    const passwordHash = await this.passwords.hash(newPassword);
    await this.database.client.$transaction([
      this.database.client.user.update({
        where: { id: principal.userId },
        data: { passwordHash, mustChangePassword: false },
      }),
      this.database.client.session.updateMany({
        where: {
          userId: principal.userId,
          id: { not: principal.sessionId },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      }),
      this.database.client.auditEvent.create({
        data: {
          actorUserId: principal.userId,
          workspaceId: principal.workspaceId,
          action: "account.password.change",
          targetType: "user",
          targetId: principal.userId,
          result: AuditResult.SUCCESS,
          requestId,
        },
      }),
    ]);
  }

  public async listSessions(principal: Principal): Promise<SessionList> {
    const sessions = await this.database.client.session.findMany({
      where: { userId: principal.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: "desc" },
    });
    return {
      data: sessions.map((session) => ({
        id: session.id,
        current: session.id === principal.sessionId,
        userAgentSummary: session.userAgentSummary,
        lastActiveAt: session.lastActiveAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
      })),
    };
  }

  public async revokeSession(
    principal: Principal,
    sessionId: string,
    requestId: string,
  ): Promise<boolean> {
    const result = await this.database.client.session.updateMany({
      where: { id: sessionId, userId: principal.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new CodedHttpException("NOT_FOUND", "Session not found.", 404);
    }
    await this.audit.record({
      actorUserId: principal.userId,
      workspaceId: principal.workspaceId,
      action: "session.revoke",
      targetType: "session",
      targetId: sessionId,
      result: "SUCCESS",
      requestId,
    });
    return sessionId === principal.sessionId;
  }

  public async revokeOtherSessions(principal: Principal, requestId: string): Promise<void> {
    const result = await this.database.client.session.updateMany({
      where: {
        userId: principal.userId,
        id: { not: principal.sessionId },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      workspaceId: principal.workspaceId,
      action: "session.revoke_others",
      targetType: "session",
      result: "SUCCESS",
      requestId,
      metadata: { revokedCount: result.count },
    });
  }
}

function principalFrom(source: PrincipalSource): Principal {
  return {
    userId: source.userId,
    workspaceId: source.workspaceId,
    sessionId: source.sessionId,
    username: source.username,
    email: source.email,
    displayName: source.displayName,
    role: source.role,
    mustChangePassword: source.mustChangePassword,
  };
}

function sanitizeUserAgent(userAgent: string): string {
  return (
    [...userAgent]
      .filter((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint >= 0x20 && codePoint !== 0x7f;
      })
      .join("")
      .slice(0, 200) || "Unknown device"
  );
}
