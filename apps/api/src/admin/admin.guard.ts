import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import { CodedHttpException } from "../http/coded-http.exception.js";
import type { RequestContext } from "../http/request-context.js";

@Injectable()
export class AdminGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestContext>();
    if (request.principal?.role !== "ADMIN") {
      throw new CodedHttpException("FORBIDDEN", "Administrator access is required.", 403);
    }
    return true;
  }
}
