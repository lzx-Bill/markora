import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { CodedHttpException } from "../http/coded-http.exception.js";
import type { RequestContext } from "../http/request-context.js";
import { AuthService } from "./auth.service.js";
import { IS_PUBLIC_ROUTE } from "./public.decorator.js";
import { readSessionToken } from "./session-token.js";

@Injectable()
export class AuthGuard implements CanActivate {
  @Inject(Reflector)
  private readonly reflector!: Reflector;

  @Inject(AuthService)
  private readonly auth!: AuthService;

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const publicRoute = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (publicRoute) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = readSessionToken(request);
    if (!token) {
      throw new CodedHttpException("UNAUTHENTICATED", "Sign in to continue.", 401);
    }
    const principal = await this.auth.authenticateSession(token);
    if (!principal) {
      throw new CodedHttpException("SESSION_REVOKED", "Your session is no longer valid.", 401);
    }
    (request as RequestContext).principal = principal;
    return true;
  }
}
