import { loadServerConfig } from "@markora/config";
import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { CodedHttpException } from "../http/coded-http.exception.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly expectedOrigin = new URL(loadServerConfig(process.env).PUBLIC_ORIGIN).origin;

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (safeMethods.has(request.method.toUpperCase())) return true;
    const origin = request.header("origin");
    if (!origin || !this.matchesOrigin(origin)) {
      throw new CodedHttpException(
        "CSRF_FAILED",
        "The request origin could not be verified. Refresh and try again.",
        403,
      );
    }
    return true;
  }

  private matchesOrigin(origin: string): boolean {
    try {
      return new URL(origin).origin === this.expectedOrigin;
    } catch {
      return false;
    }
  }
}
