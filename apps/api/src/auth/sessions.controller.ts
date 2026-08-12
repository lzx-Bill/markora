import { loadServerConfig } from "@markora/config";
import { OpaqueIdSchema, type OperationResult, type SessionList } from "@markora/contracts";
import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { AuthService } from "./auth.service.js";
import { clearSessionCookie } from "./session-token.js";

@Controller("sessions")
export class SessionsController {
  private readonly production = loadServerConfig(process.env).NODE_ENV === "production";

  @Inject(AuthService)
  private readonly auth!: AuthService;

  @Get()
  public list(@Req() request: RequestContext): Promise<SessionList> {
    return this.auth.listSessions(request.principal);
  }

  @Post("revoke-others")
  @HttpCode(200)
  public async revokeOthers(@Req() request: RequestContext): Promise<OperationResult> {
    await this.auth.revokeOtherSessions(request.principal, request.requestId);
    return { success: true };
  }

  @Delete(":id")
  public async revoke(
    @Param("id") id: string,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OperationResult> {
    const sessionId = parseRequest(OpaqueIdSchema, id);
    const revokedCurrent = await this.auth.revokeSession(
      request.principal,
      sessionId,
      request.requestId,
    );
    if (revokedCurrent) clearSessionCookie(response, this.production);
    return { success: true };
  }
}
