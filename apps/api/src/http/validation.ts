import type { z } from "zod";
import { CodedHttpException } from "./coded-http.exception.js";

export function parseRequest<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new CodedHttpException("VALIDATION_FAILED", "The request is invalid.", 400, {
      fields: result.error.issues.map((issue) => issue.path.join(".")),
    });
  }
  return result.data;
}
