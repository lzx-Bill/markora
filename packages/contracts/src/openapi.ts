import { z } from "zod";
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  OperationResultSchema,
  PrincipalSchema,
  SessionListSchema,
} from "./auth.js";
import {
  BulkDocumentRequestSchema,
  BulkDocumentResultSchema,
  CreateDocumentRequestSchema,
  CreateFolderRequestSchema,
  DocumentDetailSchema,
  DocumentListSchema,
  FolderSchema,
  FolderTreeSchema,
  TrashResultSchema,
  UpdateDocumentRequestSchema,
  UpdateFolderRequestSchema,
  WorkspaceSummarySchema,
} from "./content.js";
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
const workspaceSummarySchema = z.toJSONSchema(WorkspaceSummarySchema, { target: "draft-7" });
const folderTreeSchema = z.toJSONSchema(FolderTreeSchema, { target: "draft-7" });
const folderSchema = z.toJSONSchema(FolderSchema, { target: "draft-7" });
const createFolderSchema = z.toJSONSchema(CreateFolderRequestSchema, { target: "draft-7" });
const updateFolderSchema = z.toJSONSchema(UpdateFolderRequestSchema, { target: "draft-7" });
const documentListSchema = z.toJSONSchema(DocumentListSchema, { target: "draft-7" });
const documentDetailSchema = z.toJSONSchema(DocumentDetailSchema, { target: "draft-7" });
const createDocumentSchema = z.toJSONSchema(CreateDocumentRequestSchema, { target: "draft-7" });
const updateDocumentSchema = z.toJSONSchema(UpdateDocumentRequestSchema, { target: "draft-7" });
const bulkDocumentSchema = z.toJSONSchema(BulkDocumentRequestSchema, { target: "draft-7" });
const bulkDocumentResultSchema = z.toJSONSchema(BulkDocumentResultSchema, { target: "draft-7" });
const trashResultSchema = z.toJSONSchema(TrashResultSchema, { target: "draft-7" });

const uuidPathParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
} as const;

function jsonBody(schema: object) {
  return { required: true, content: { "application/json": { schema } } };
}

function jsonResponse(description: string, schema: object) {
  return { description, content: { "application/json": { schema } } };
}

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Markora API",
    version: "0.0.0",
    description: "Runtime contract for the Markora V1 API.",
  },
  servers: [{ url: "/api/v1" }],
  paths: {
    "/workspace": {
      get: {
        operationId: "getWorkspace",
        responses: {
          "200": jsonResponse("Authenticated workspace summary.", workspaceSummarySchema),
        },
      },
    },
    "/folders/tree": {
      get: {
        operationId: "getFolderTree",
        responses: {
          "200": jsonResponse(
            "Reachable active folder tree with recursive counts.",
            folderTreeSchema,
          ),
        },
      },
    },
    "/folders": {
      post: {
        operationId: "createFolder",
        requestBody: jsonBody(createFolderSchema),
        responses: {
          "201": jsonResponse("Folder created.", folderSchema),
          "409": jsonResponse("Normalized sibling name conflict.", errorSchema),
        },
      },
    },
    "/folders/{id}": {
      patch: {
        operationId: "updateFolder",
        parameters: [uuidPathParameter],
        requestBody: jsonBody(updateFolderSchema),
        responses: {
          "200": jsonResponse("Folder renamed or moved.", folderSchema),
          "404": jsonResponse("Folder absent from this workspace.", errorSchema),
          "409": jsonResponse("Name or metadata conflict.", errorSchema),
          "422": jsonResponse("Cycle, depth, or naming policy violation.", errorSchema),
        },
      },
    },
    "/folders/{id}/trash": {
      post: {
        operationId: "trashFolder",
        parameters: [uuidPathParameter],
        responses: {
          "201": jsonResponse("Folder subtree hidden from active navigation.", trashResultSchema),
        },
      },
    },
    "/documents": {
      get: {
        operationId: "listDocuments",
        parameters: [
          { name: "folderId", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: { "200": jsonResponse("Active documents in one folder.", documentListSchema) },
      },
      post: {
        operationId: "createDocument",
        requestBody: jsonBody(createDocumentSchema),
        responses: {
          "201": jsonResponse("Document created.", documentDetailSchema),
          "409": jsonResponse("Normalized sibling name conflict.", errorSchema),
          "422": jsonResponse("Document name is unsafe or lacks .md.", errorSchema),
        },
      },
    },
    "/documents/bulk": {
      post: {
        operationId: "bulkDocuments",
        requestBody: jsonBody(bulkDocumentSchema),
        responses: {
          "201": jsonResponse("Itemized move or trash results.", bulkDocumentResultSchema),
        },
      },
    },
    "/documents/{id}": {
      get: {
        operationId: "getDocument",
        parameters: [uuidPathParameter],
        responses: {
          "200": jsonResponse(
            "Document content and stable-ID navigation metadata.",
            documentDetailSchema,
          ),
          "404": jsonResponse("Document absent from this workspace.", errorSchema),
        },
      },
      patch: {
        operationId: "updateDocument",
        parameters: [uuidPathParameter],
        requestBody: jsonBody(updateDocumentSchema),
        responses: {
          "200": jsonResponse(
            "Document renamed or moved without changing content revision.",
            documentDetailSchema,
          ),
          "409": jsonResponse("Name or metadata conflict.", errorSchema),
        },
      },
    },
    "/documents/{id}/trash": {
      post: {
        operationId: "trashDocument",
        parameters: [uuidPathParameter],
        responses: {
          "201": jsonResponse("Document hidden from active navigation.", trashResultSchema),
        },
      },
    },
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
