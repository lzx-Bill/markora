import { randomUUID } from "node:crypto";
import { createApiError, type ErrorCode } from "@markora/contracts";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { CodedHttpException } from "./http/coded-http.exception.js";

const statusCodes: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: "VALIDATION_FAILED",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHENTICATED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.CONFLICT]: "RESOURCE_STATE_CONFLICT",
  [HttpStatus.PAYLOAD_TOO_LARGE]: "LIMIT_EXCEEDED",
  [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMITED",
  [HttpStatus.SERVICE_UNAVAILABLE]: "DEPENDENCY_UNAVAILABLE",
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const requestId =
      (request as Request & { requestId?: string }).requestId ??
      request.header("x-request-id") ??
      `req_${randomUUID()}`;
    const status = this.statusOf(exception);
    const code =
      exception instanceof CodedHttpException
        ? exception.code
        : (statusCodes[status] ?? "INTERNAL_ERROR");
    const message =
      status >= 500
        ? "The service could not complete the request. Your data was not changed."
        : this.safeMessage(exception);

    response
      .status(status)
      .header("x-request-id", requestId)
      .header("x-error-code", code)
      .json(
        createApiError(
          code,
          message,
          requestId,
          exception instanceof CodedHttpException ? exception.details : undefined,
        ),
      );
  }

  private statusOf(exception: unknown): number {
    if (exception instanceof HttpException) return exception.getStatus();
    if (exception && typeof exception === "object") {
      const candidate = exception as { status?: unknown; statusCode?: unknown };
      const status = candidate.status ?? candidate.statusCode;
      if (typeof status === "number" && status >= 400 && status < 600) return status;
    }
    return 500;
  }

  private safeMessage(exception: unknown): string {
    if (!(exception instanceof HttpException)) return "The request could not be completed.";
    const response = exception.getResponse();
    if (typeof response === "string") return response;
    if (typeof response === "object" && response && "message" in response) {
      const message = response.message;
      if (typeof message === "string") return message;
      if (Array.isArray(message))
        return message.filter((item) => typeof item === "string").join("; ");
    }
    return "The request could not be completed.";
  }
}
