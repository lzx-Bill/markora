import { z } from "zod";
import { OpaqueIdSchema, OperationResultSchema } from "./auth.js";
import { NullableOpaqueIdSchema } from "./content.js";

export const DocumentVersionReasonSchema = z.enum([
  "AUTO_SAVE",
  "CONFLICT_OVERWRITE",
  "RESTORE",
  "IMPORT_REPLACE",
]);

export const DocumentVersionSummarySchema = z.object({
  id: OpaqueIdSchema,
  versionNo: z.number().int().positive(),
  documentName: z.string(),
  reason: DocumentVersionReasonSchema,
  sourceRevision: z.number().int().positive(),
  actor: z.object({ id: OpaqueIdSchema, displayName: z.string() }),
  createdAt: z.iso.datetime(),
});

export const DocumentVersionListSchema = z.object({
  data: z.array(DocumentVersionSummarySchema),
  retentionDays: z.number().int().positive(),
  nextCursor: z.string().nullable(),
});

export const DocumentVersionDetailSchema = DocumentVersionSummarySchema.extend({
  documentId: OpaqueIdSchema,
  markdown: z.string(),
});

export const RestoreDocumentVersionRequestSchema = z
  .object({ baseRevision: z.number().int().positive() })
  .strict();

export const RestoreDocumentVersionResultSchema = z.object({
  documentId: OpaqueIdSchema,
  revision: z.number().int().positive(),
  restoredVersionId: OpaqueIdSchema,
  safetyVersionId: OpaqueIdSchema,
  restoredAt: z.iso.datetime(),
});

export const RestoreConflictStrategySchema = z.enum(["FAIL", "KEEP_BOTH"]);
export const RestoreResourceRequestSchema = z
  .object({
    targetParentId: NullableOpaqueIdSchema.optional(),
    conflictStrategy: RestoreConflictStrategySchema.default("FAIL"),
  })
  .strict();

export const RestoreResourceResultSchema = OperationResultSchema.extend({
  id: OpaqueIdSchema,
  name: z.string(),
  parentId: NullableOpaqueIdSchema,
  restoredAt: z.iso.datetime(),
});

export const TrashItemSchema = z.object({
  id: OpaqueIdSchema,
  type: z.enum(["FOLDER", "DOCUMENT"]),
  name: z.string(),
  originalParentId: NullableOpaqueIdSchema,
  originalPath: z.string(),
  deletedAt: z.iso.datetime(),
  permanentlyDeletableAt: z.iso.datetime(),
  state: z.enum(["TRASHED", "DELETING"]),
});

export const TrashListSchema = z.object({
  data: z.array(TrashItemSchema),
  retentionDays: z.number().int().positive(),
  nextCursor: z.string().nullable(),
});

export const BackgroundJobStateSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "SUCCEEDED_WITH_ISSUES",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
]);

export const BackgroundJobSchema = z.object({
  id: OpaqueIdSchema,
  type: z.enum(["PERMANENT_DELETE_FOLDER", "PERMANENT_DELETE_DOCUMENT", "IMPORT", "EXPORT"]),
  state: BackgroundJobStateSchema,
  targetType: z.enum(["folder", "document", "import-plan", "export"]),
  targetId: OpaqueIdSchema,
  progress: z.number().int().min(0).max(100),
  progressDetail: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    currentItem: z.string().nullable(),
    phase: z.string(),
  }),
  result: z.record(z.string(), z.unknown()).nullable(),
  errorCode: z.string().nullable(),
  parentJobId: OpaqueIdSchema.nullable(),
  cancellationRequested: z.boolean(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});

export const PermanentDeleteResultSchema = z.object({
  accepted: z.literal(true),
  job: BackgroundJobSchema,
});

export type DocumentVersionSummary = z.infer<typeof DocumentVersionSummarySchema>;
export type DocumentVersionList = z.infer<typeof DocumentVersionListSchema>;
export type DocumentVersionDetail = z.infer<typeof DocumentVersionDetailSchema>;
export type RestoreDocumentVersionRequest = z.infer<typeof RestoreDocumentVersionRequestSchema>;
export type RestoreDocumentVersionResult = z.infer<typeof RestoreDocumentVersionResultSchema>;
export type RestoreResourceRequest = z.infer<typeof RestoreResourceRequestSchema>;
export type RestoreResourceResult = z.infer<typeof RestoreResourceResultSchema>;
export type TrashItem = z.infer<typeof TrashItemSchema>;
export type TrashList = z.infer<typeof TrashListSchema>;
export type BackgroundJob = z.infer<typeof BackgroundJobSchema>;
export type PermanentDeleteResult = z.infer<typeof PermanentDeleteResultSchema>;
