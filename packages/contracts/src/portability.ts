import { z } from "zod";
import { OpaqueIdSchema } from "./auth.js";
import { BackgroundJobSchema } from "./recovery.js";

export const ImportConflictStrategySchema = z.enum(["KEEP_BOTH", "SKIP", "REPLACE"]);

export const ImportUploadResultSchema = z.object({
  uploadToken: z.string().min(32),
  filesReceived: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
});

export const ImportPreviewRequestSchema = z
  .object({
    uploadToken: z.string().min(32).max(2048),
    targetFolderId: OpaqueIdSchema.nullable().default(null),
  })
  .strict();

export const ImportPreviewItemSchema = z.object({
  sourceKey: z.string().min(32),
  sourcePath: z.string(),
  targetPath: z.string(),
  bytes: z.number().int().nonnegative(),
  status: z.enum(["READY", "CONFLICT", "NORMALIZED"]),
});

export const ImportPreviewResultSchema = z.object({
  planId: OpaqueIdSchema,
  targetFolderId: OpaqueIdSchema.nullable(),
  summary: z.object({
    documents: z.number().int().nonnegative(),
    folders: z.number().int().nonnegative(),
    ignoredNonMarkdown: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    normalized: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  }),
  items: z.array(ImportPreviewItemSchema),
  warnings: z.array(
    z.object({ code: z.string(), message: z.string(), count: z.number().int().positive() }),
  ),
  expiresAt: z.iso.datetime(),
});

export const ExecuteImportRequestSchema = z
  .object({
    idempotencyKey: z.uuid(),
    conflictStrategy: ImportConflictStrategySchema.default("KEEP_BOTH"),
    overrides: z
      .array(
        z
          .object({ sourceKey: z.string().min(32), strategy: ImportConflictStrategySchema })
          .strict(),
      )
      .max(10_000)
      .default([]),
  })
  .strict();

export const AcceptedJobSchema = z.object({ accepted: z.literal(true), job: BackgroundJobSchema });

export const JobItemSchema = z.object({
  id: OpaqueIdSchema,
  sourceKey: z.string(),
  state: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "SKIPPED", "FAILED", "CANCELLED"]),
  result: z.record(z.string(), z.unknown()).nullable(),
  errorCode: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});

export const JobItemPageSchema = z.object({
  data: z.array(JobItemSchema),
  nextCursor: z.string().nullable(),
});

export const ExportRequestSchema = z
  .object({
    scope: z.enum(["selection", "folder", "workspace"]),
    ids: z.array(OpaqueIdSchema).min(1).max(2_000).optional(),
    folderId: OpaqueIdSchema.optional(),
    idempotencyKey: z.uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scope === "selection" && !value.ids) {
      context.addIssue({
        code: "custom",
        path: ["ids"],
        message: "ids are required for selection export.",
      });
    }
    if (value.scope !== "selection" && value.ids) {
      context.addIssue({
        code: "custom",
        path: ["ids"],
        message: "ids are accepted only for selection export.",
      });
    }
    if (value.scope === "folder" && !value.folderId) {
      context.addIssue({
        code: "custom",
        path: ["folderId"],
        message: "folderId is required for folder export.",
      });
    }
    if (value.scope !== "folder" && value.folderId) {
      context.addIssue({
        code: "custom",
        path: ["folderId"],
        message: "folderId is accepted only for folder export.",
      });
    }
  });

export const CreateExportResultSchema = z.object({
  accepted: z.literal(true),
  job: BackgroundJobSchema,
  downloadToken: z.string().min(32),
  expiresAt: z.iso.datetime(),
});

export const DownloadTokenQuerySchema = z.object({ token: z.string().min(32).max(4096) }).strict();

export type ImportConflictStrategy = z.infer<typeof ImportConflictStrategySchema>;
export type ImportUploadResult = z.infer<typeof ImportUploadResultSchema>;
export type ImportPreviewRequest = z.infer<typeof ImportPreviewRequestSchema>;
export type ImportPreviewResult = z.infer<typeof ImportPreviewResultSchema>;
export type ImportPreviewItem = z.infer<typeof ImportPreviewItemSchema>;
export type ExecuteImportRequest = z.infer<typeof ExecuteImportRequestSchema>;
export type AcceptedJob = z.infer<typeof AcceptedJobSchema>;
export type JobItem = z.infer<typeof JobItemSchema>;
export type JobItemPage = z.infer<typeof JobItemPageSchema>;
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export type CreateExportResult = z.infer<typeof CreateExportResultSchema>;
