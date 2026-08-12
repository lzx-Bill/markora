import { z } from "zod";
import { OpaqueIdSchema } from "./auth.js";

const BooleanQuerySchema = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean(),
);

export const SearchScopeSchema = z.enum(["all", "folder", "subtree"]);
export const SearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(500),
    scope: SearchScopeSchema.default("all"),
    folderId: OpaqueIdSchema.optional(),
    includeCodeBlocks: BooleanQuerySchema.default(false),
    cursor: z.string().max(1024).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scope !== "all" && value.folderId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["folderId"],
        message: "folderId is required for folder and subtree search.",
      });
    }
    if (value.scope === "all" && value.folderId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["folderId"],
        message: "folderId is not accepted for all-workspace search.",
      });
    }
  });

export const SearchResultSchema = z.object({
  documentId: OpaqueIdSchema,
  name: z.string(),
  path: z.string(),
  snippet: z.string(),
  score: z.number().nonnegative(),
  matchHints: z.array(z.enum(["name", "path", "body", "code"])),
});

export const SearchResultPageSchema = z.object({
  data: z.array(SearchResultSchema),
  nextCursor: z.string().nullable(),
});

export const QuickOpenQuerySchema = z
  .object({ q: z.string().trim().max(200).default("") })
  .strict();

export const QuickOpenItemSchema = z.object({
  documentId: OpaqueIdSchema,
  name: z.string(),
  path: z.string(),
  updatedAt: z.iso.datetime(),
});

export const QuickOpenResultSchema = z.object({ data: z.array(QuickOpenItemSchema).max(20) });

export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SearchResultPage = z.infer<typeof SearchResultPageSchema>;
export type QuickOpenQuery = z.infer<typeof QuickOpenQuerySchema>;
export type QuickOpenItem = z.infer<typeof QuickOpenItemSchema>;
export type QuickOpenResult = z.infer<typeof QuickOpenResultSchema>;
