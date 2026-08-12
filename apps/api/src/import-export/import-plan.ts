import { z } from "zod";

export const StoredUploadManifestSchema = z.object({
  entries: z.array(
    z.object({
      relativePath: z.string(),
      storageName: z.string(),
      sha256: z.string().length(64),
      bytes: z.number().int().nonnegative(),
      kind: z.enum(["FILE", "ZIP"]),
    }),
  ),
});

export const StoredImportItemSchema = z.object({
  sourceKey: z.string().length(64),
  sourcePath: z.string(),
  targetPath: z.string(),
  directoryNames: z.array(z.string()),
  documentName: z.string(),
  storageRelativePath: z.string(),
  sha256: z.string().length(64),
  bytes: z.number().int().nonnegative(),
  status: z.enum(["READY", "CONFLICT", "NORMALIZED"]),
});

export const StoredImportPreviewSchema = z.object({
  targetFolderId: z.uuid().nullable(),
  summary: z.object({
    documents: z.number().int().nonnegative(),
    folders: z.number().int().nonnegative(),
    ignoredNonMarkdown: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    normalized: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  }),
  items: z.array(StoredImportItemSchema),
  warnings: z.array(
    z.object({ code: z.string(), message: z.string(), count: z.number().int().positive() }),
  ),
});

export type StoredUploadManifest = z.infer<typeof StoredUploadManifestSchema>;
export type StoredImportPreview = z.infer<typeof StoredImportPreviewSchema>;
