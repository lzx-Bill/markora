import { loadServerConfig } from "@markora/config";
import {
  LoginRequestSchema,
  type LoginResponse,
  type OperationResult,
  type Principal,
} from "@markora/contracts";
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { AuthService } from "./auth.service.js";
import { PublicRoute } from "./public.decorator.js";
import { clearSessionCookie, setSessionCookie } from "./session-token.js";

@Controller("auth")
export class AuthController {
  private readonly config = loadServerConfig(process.env);

  @Inject(AuthService)
  private readonly auth!: AuthService;

  @PublicRoute()
  @Post("login")
  @HttpCode(200)
  public async login(
    @Body() body: unknown,
    @Req() request: Request & { requestId: string },
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const input = parseRequest(LoginRequestSchema, body);
    const result = await this.auth.login(
      input.identifier,
      input.password,
      request.ip || request.socket.remoteAddress || "unknown",
      request.header("user-agent") ?? "Unknown device",
      request.requestId,
    );
    setSessionCookie(
      response,
      result.token,
      result.sessionTtlDays,
      this.config.NODE_ENV === "production",
    );
    return { principal: result.principal };
  }

  @Post("logout")
  @HttpCode(200)
  public async logout(
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OperationResult> {
    await this.auth.logout(request.principal, request.requestId);
    clearSessionCookie(response, this.config.NODE_ENV === "production");
    return { success: true };
  }

  @Get("me")
  public me(@Req() request: RequestContext): Principal {
    return request.principal;
  }
}
