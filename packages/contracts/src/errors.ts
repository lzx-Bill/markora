import { z } from "zod";

export const ErrorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "AUTHENTICATION_FAILED",
  "PASSWORD_POLICY_FAILED",
  "CSRF_FAILED",
  "BOOTSTRAP_DISABLED",
  "NAME_CONFLICT",
  "INVALID_NAME",
  "FOLDER_CYCLE",
  "NOT_FOUND",
  "FORBIDDEN",
  "REVISION_CONFLICT",
  "RESOURCE_STATE_CONFLICT",
  "LIMIT_EXCEEDED",
  "INVALID_ENCODING",
  "UNSAFE_ARCHIVE",
  "PLAN_EXPIRED",
  "JOB_NOT_RETRYABLE",
  "JOB_NOT_CANCELLABLE",
  "SESSION_REVOKED",
  "RATE_LIMITED",
  "DEPENDENCY_UNAVAILABLE",
  "CONFIG_VERSION_CONFLICT",
  "INTERNAL_ERROR",
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    requestId: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export function createApiError(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): ApiError {
  return ApiErrorSchema.parse({
    error: { code, message, requestId, ...(details ? { details } : {}) },
  });
}
