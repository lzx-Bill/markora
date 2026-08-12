import type { QuickOpenItem, SearchQuery } from "@markora/contracts";

export interface SearchProviderRow {
  readonly documentId: string;
  readonly name: string;
  readonly path: string;
  readonly markdown: string;
  readonly score: number;
}

export interface SearchProviderPage {
  readonly data: readonly SearchProviderRow[];
  readonly hasMore: boolean;
}

export interface SearchProvider {
  search(workspaceId: string, query: SearchQuery, offset: number): Promise<SearchProviderPage>;
  quickOpen(workspaceId: string, query: string): Promise<readonly QuickOpenItem[]>;
}

export const SEARCH_PROVIDER = Symbol("SEARCH_PROVIDER");
