import { z } from "zod";
import { OpaqueIdSchema, OperationResultSchema } from "./auth.js";

export const NullableOpaqueIdSchema = OpaqueIdSchema.nullable();
export const ResourceStateSchema = z.enum(["ACTIVE", "TRASHED", "DELETING"]);

export const WorkspaceSummarySchema = z.object({
  id: OpaqueIdSchema,
  ownerUserId: OpaqueIdSchema,
  rootFolderCount: z.number().int().nonnegative(),
  rootDocumentCount: z.number().int().nonnegative(),
});

export type FolderTreeNode = {
  id: string;
  parentId: string | null;
  name: string;
  documentCount: number;
  updatedAt: string;
  children: FolderTreeNode[];
};

export const FolderTreeNodeSchema: z.ZodType<FolderTreeNode> = z.lazy(() =>
  z.object({
    id: OpaqueIdSchema,
    parentId: NullableOpaqueIdSchema,
    name: z.string(),
    documentCount: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime(),
    children: z.array(FolderTreeNodeSchema),
  }),
);

export const FolderTreeSchema = z.object({
  data: z.array(FolderTreeNodeSchema),
  versionToken: z.string(),
});

export const FolderSchema = z.object({
  id: OpaqueIdSchema,
  parentId: NullableOpaqueIdSchema,
  name: z.string(),
  state: ResourceStateSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CreateFolderRequestSchema = z
  .object({
    parentId: NullableOpaqueIdSchema.default(null),
    name: z.string().min(1).max(1024),
  })
  .strict();

export const UpdateFolderRequestSchema = z
  .object({
    name: z.string().min(1).max(1024).optional(),
    parentId: NullableOpaqueIdSchema.optional(),
    expectedUpdatedAt: z.iso.datetime(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.parentId !== undefined, {
    message: "A name or parentId change is required.",
  });

export const DocumentSummarySchema = z.object({
  id: OpaqueIdSchema,
  folderId: NullableOpaqueIdSchema,
  name: z.string(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const BreadcrumbSchema = z.object({ id: OpaqueIdSchema, name: z.string() });
export const DocumentDetailSchema = DocumentSummarySchema.extend({
  markdown: z.string(),
  breadcrumbs: z.array(BreadcrumbSchema),
  capabilities: z.object({
    source: z.literal(true),
    wysiwyg: z.literal(false),
    split: z.literal(false),
  }),
});

export const DocumentListSchema = z.object({ data: z.array(DocumentSummarySchema) });

export const CreateDocumentRequestSchema = z
  .object({
    folderId: NullableOpaqueIdSchema.default(null),
    name: z.string().min(1).max(1024),
    markdown: z.string().optional().default(""),
  })
  .strict();

export const UpdateDocumentRequestSchema = z
  .object({
    name: z.string().min(1).max(1024).optional(),
    folderId: NullableOpaqueIdSchema.optional(),
    expectedUpdatedAt: z.iso.datetime(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.folderId !== undefined, {
    message: "A name or folderId change is required.",
  });

export const BulkDocumentRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("MOVE"),
      documentIds: z.array(OpaqueIdSchema).min(1).max(100),
      targetFolderId: NullableOpaqueIdSchema,
    })
    .strict(),
  z
    .object({ operation: z.literal("TRASH"), documentIds: z.array(OpaqueIdSchema).min(1).max(100) })
    .strict(),
]);

export const BulkDocumentResultSchema = z.object({
  data: z.array(
    z.object({
      documentId: OpaqueIdSchema,
      success: z.boolean(),
      errorCode: z.string().optional(),
      message: z.string().optional(),
    }),
  ),
});

export const TrashResultSchema = OperationResultSchema.extend({ trashedAt: z.iso.datetime() });

export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;
export type FolderTree = z.infer<typeof FolderTreeSchema>;
export type Folder = z.infer<typeof FolderSchema>;
export type CreateFolderRequest = z.infer<typeof CreateFolderRequestSchema>;
export type UpdateFolderRequest = z.infer<typeof UpdateFolderRequestSchema>;
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;
export type DocumentList = z.infer<typeof DocumentListSchema>;
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequestSchema>;
export type UpdateDocumentRequest = z.infer<typeof UpdateDocumentRequestSchema>;
export type BulkDocumentRequest = z.infer<typeof BulkDocumentRequestSchema>;
export type BulkDocumentResult = z.infer<typeof BulkDocumentResultSchema>;
export type TrashResult = z.infer<typeof TrashResultSchema>;
