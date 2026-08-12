import type { NextFunction, Request, Response } from "express";
import type { RequestContext } from "./request-context.js";
import { writeStructuredLog } from "./structured-log.js";

export function requestLogMiddleware(
  request: Request & { requestId?: string },
  response: Response,
  next: NextFunction,
): void {
  const startedAt = performance.now();
  response.once("finish", () => {
    const principal = (request as Partial<RequestContext>).principal;
    const errorCode = response.getHeader("x-error-code")?.toString();
    writeStructuredLog({
      level: response.statusCode >= 500 ? "error" : response.statusCode >= 400 ? "warn" : "info",
      service: "api",
      event: "http.request.completed",
      ...(request.requestId ? { requestId: request.requestId } : {}),
      ...(principal?.userId ? { actorUserId: principal.userId } : {}),
      route: request.path,
      method: request.method,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      result: String(response.statusCode),
      ...(errorCode ? { errorCode } : {}),
    });
  });
  next();
}
