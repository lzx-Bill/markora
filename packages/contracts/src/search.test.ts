import { describe, expect, it } from "vitest";
import { QuickOpenQuerySchema, SearchQuerySchema, SearchResultPageSchema } from "./search.js";

describe("search contracts", () => {
  it("normalizes query defaults and requires a folder for scoped search", () => {
    expect(SearchQuerySchema.parse({ q: "  分布式  " })).toEqual({
      q: "分布式",
      scope: "all",
      includeCodeBlocks: false,
    });
    expect(SearchQuerySchema.safeParse({ q: "term", scope: "subtree" }).success).toBe(false);
    expect(
      SearchQuerySchema.safeParse({
        q: "term",
        scope: "all",
        folderId: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
  });

  it("parses HTTP booleans, bounded Quick Open queries and cursor pages", () => {
    expect(
      SearchQuerySchema.parse({ q: "code", includeCodeBlocks: "true" }).includeCodeBlocks,
    ).toBe(true);
    expect(QuickOpenQuerySchema.parse({})).toEqual({ q: "" });
    expect(
      SearchResultPageSchema.parse({
        data: [],
        nextCursor: "NTA",
      }),
    ).toEqual({ data: [], nextCursor: "NTA" });
  });
});
