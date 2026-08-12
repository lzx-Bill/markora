import { z } from "zod";
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  OperationResultSchema,
  PrincipalSchema,
  SessionListSchema,
} from "./auth.js";
import { ApiErrorSchema } from "./errors.js";
import { HealthResponseSchema } from "./health.js";

const healthSchema = z.toJSONSchema(HealthResponseSchema, { target: "draft-7" });
const errorSchema = z.toJSONSchema(ApiErrorSchema, { target: "draft-7" });
const loginRequestSchema = z.toJSONSchema(LoginRequestSchema, { target: "draft-7" });
const loginResponseSchema = z.toJSONSchema(LoginResponseSchema, { target: "draft-7" });
const principalSchema = z.toJSONSchema(PrincipalSchema, { target: "draft-7" });
const changePasswordSchema = z.toJSONSchema(ChangePasswordRequestSchema, { target: "draft-7" });
const sessionListSchema = z.toJSONSchema(SessionListSchema, { target: "draft-7" });
const operationResultSchema = z.toJSONSchema(OperationResultSchema, { target: "draft-7" });

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Markora API",
    version: "0.0.0",
    description: "Runtime contract for the Markora V1 API.",
  },
  servers: [{ url: "/api/v1" }],
  paths: {
    "/auth/login": {
      post: {
        operationId: "login",
        requestBody: {
          required: true,
          content: { "application/json": { schema: loginRequestSchema } },
        },
        responses: {
          "200": {
            description: "Authenticated with an opaque HttpOnly cookie session.",
            content: { "application/json": { schema: loginResponseSchema } },
          },
          "401": {
            description: "Credentials are invalid.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": {
            description: "Login is temporarily rate limited.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/auth/logout": {
      post: {
        operationId: "logout",
        responses: {
          "200": {
            description: "Current session revoked.",
            content: { "application/json": { schema: operationResultSchema } },
          },
        },
      },
    },
    "/auth/me": {
      get: {
        operationId: "getCurrentPrincipal",
        responses: {
          "200": {
            description: "Current authenticated principal.",
            content: { "application/json": { schema: principalSchema } },
          },
          "401": {
            description: "No valid session.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/account/password": {
      post: {
        operationId: "changePassword",
        requestBody: {
          required: true,
          content: { "application/json": { schema: changePasswordSchema } },
        },
        responses: {
          "200": {
            description: "Password changed and other sessions revoked.",
            content: { "application/json": { schema: operationResultSchema } },
          },
        },
      },
    },
    "/sessions": {
      get: {
        operationId: "listSessions",
        responses: {
          "200": {
            description: "Safe summaries of the user's sessions.",
            content: { "application/json": { schema: sessionListSchema } },
          },
        },
      },
    },
    "/sessions/{id}": {
      delete: {
        operationId: "revokeSession",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Owned session revoked.",
            content: { "application/json": { schema: operationResultSchema } },
          },
          "404": {
            description: "Session is absent or belongs to another user.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/sessions/revoke-others": {
      post: {
        operationId: "revokeOtherSessions",
        responses: {
          "200": {
            description: "All sessions except the current session revoked.",
            content: { "application/json": { schema: operationResultSchema } },
          },
        },
      },
    },
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
