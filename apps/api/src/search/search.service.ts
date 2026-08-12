import type {
  Principal,
  QuickOpenQuery,
  QuickOpenResult,
  SearchQuery,
  SearchResult,
  SearchResultPage,
} from "@markora/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { ContentRepository } from "../content/content.repository.js";
import { CodedHttpException } from "../http/coded-http.exception.js";
import { SEARCH_PROVIDER, type SearchProvider, type SearchProviderRow } from "./search.provider.js";

@Injectable()
export class SearchService {
  @Inject(SEARCH_PROVIDER)
  private readonly provider!: SearchProvider;

  @Inject(ContentRepository)
  private readonly content!: ContentRepository;

  public async search(principal: Principal, query: SearchQuery): Promise<SearchResultPage> {
    if (
      query.folderId &&
      !(await this.content.findVisibleFolder(principal.workspaceId, query.folderId))
    ) {
      throw new CodedHttpException("NOT_FOUND", "Folder not found.", 404);
    }
    const offset = query.cursor ? this.decodeCursor(query.cursor) : 0;
    const page = await this.provider.search(principal.workspaceId, query, offset);
    return {
      data: page.data.map((row) => this.result(row, query)),
      nextCursor: page.hasMore
        ? Buffer.from(String(offset + page.data.length), "utf8").toString("base64url")
        : null,
    };
  }

  public async quickOpen(principal: Principal, query: QuickOpenQuery): Promise<QuickOpenResult> {
    return { data: [...(await this.provider.quickOpen(principal.workspaceId, query.q))] };
  }

  private result(row: SearchProviderRow, query: SearchQuery): SearchResult {
    const searchableMarkdown = query.includeCodeBlocks ? row.markdown : stripCode(row.markdown);
    const nameMatches = includesFolded(row.name, query.q);
    const pathMatches = includesFolded(row.path, query.q);
    const bodyMatches = includesFolded(searchableMarkdown, query.q);
    const codeMatches =
      query.includeCodeBlocks &&
      extractCode(row.markdown).some((block) => includesFolded(block, query.q));
    const matchHints: SearchResult["matchHints"] = [];
    if (nameMatches) matchHints.push("name");
    if (pathMatches) matchHints.push("path");
    if (bodyMatches) matchHints.push(codeMatches ? "code" : "body");
    return {
      documentId: row.documentId,
      name: row.name,
      path: row.path,
      snippet: snippet(searchableMarkdown, query.q),
      score: Math.max(0, row.score),
      matchHints,
    };
  }

  private decodeCursor(cursor: string): number {
    const decoded = Number(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Number.isSafeInteger(decoded) || decoded < 0 || decoded > 1_000_000) {
      throw new CodedHttpException("VALIDATION_FAILED", "The search cursor is invalid.", 400);
    }
    return decoded;
  }
}

export function stripCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/gu, " ").replace(/`[^`]*`/gu, " ");
}

function extractCode(markdown: string): string[] {
  return [...markdown.matchAll(/```([^`]*)```/gsu), ...markdown.matchAll(/`([^`]*)`/gu)].map(
    (match) => match[1] ?? "",
  );
}

function includesFolded(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function snippet(markdown: string, query: string): string {
  const compact = markdown.replace(/\s+/gu, " ").trim();
  if (compact.length === 0) return "No text preview available.";
  const match = compact.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, match < 0 ? 0 : match - 70);
  const end = Math.min(compact.length, (match < 0 ? 0 : match + query.length) + 110);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}
