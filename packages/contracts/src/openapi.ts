import { z } from "zod";
import { ApiErrorSchema } from "./errors.js";
import { HealthResponseSchema } from "./health.js";

const healthSchema = z.toJSONSchema(HealthResponseSchema, { target: "draft-7" });
const errorSchema = z.toJSONSchema(ApiErrorSchema, { target: "draft-7" });

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Markora API",
    version: "0.0.0",
    description: "Runtime contract for the Markora V1 API.",
  },
  servers: [{ url: "/api/v1" }],
  paths: {
    "/health/live": {
      get: {
        operationId: "getLiveness",
        responses: {
          "200": {
            description: "API process is alive.",
            content: { "application/json": { schema: healthSchema } },
          },
        },
      },
    },
    "/health/ready": {
      get: {
        operationId: "getReadiness",
        responses: {
          "200": {
            description: "API dependencies are ready.",
            content: { "application/json": { schema: healthSchema } },
          },
          "503": {
            description: "A required dependency is unavailable.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
  },
} as const;

export function serializeOpenApi(): string {
  return `${JSON.stringify(openApiDocument, null, 2)}\n`;
}
