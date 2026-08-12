import type { Principal } from "@markora/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { readPreferenceSettings } from "./preferences.js";
import { flattenFolders, GlobalRail } from "./WorkspacePage.js";
import { getFolderTree, searchDocuments } from "./workspace-api.js";

interface SearchFilters {
  readonly q: string;
  readonly scope: "all" | "folder" | "subtree";
  readonly folderId?: string;
  readonly includeCodeBlocks: boolean;
}

export function SearchPage({
  principal,
  onLogout,
}: {
  readonly principal: Principal;
  readonly onLogout: () => void | Promise<void>;
}) {
  const treeQuery = useQuery({ queryKey: ["folders", "tree"], queryFn: getFolderTree });
  const folders = useMemo(() => flattenFolders(treeQuery.data?.data ?? []), [treeQuery.data]);
  const preferences = readPreferenceSettings();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchFilters["scope"]>(
    preferences.searchScope === "CURRENT_FOLDER" ? "subtree" : "all",
  );
  const [folderId, setFolderId] = useState("");
  const [includeCodeBlocks, setIncludeCodeBlocks] = useState(
    preferences.includeCodeBlocks ?? false,
  );
  const [filters, setFilters] = useState<SearchFilters | null>(null);
  const searchQuery = useInfiniteQuery({
    queryKey: ["search", filters],
    queryFn: ({ pageParam }) =>
      searchDocuments({
        ...(filters ?? { q: "", scope: "all", includeCodeBlocks: false }),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(filters),
    retry: false,
  });
  const results = searchQuery.data?.pages.flatMap((page) => page.data) ?? [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (!q || (scope !== "all" && !folderId)) return;
    setFilters({
      q,
      scope,
      ...(scope === "all" ? {} : { folderId }),
      includeCodeBlocks,
    });
    rememberSearch(q);
  }

  return (
    <div className="app-shell search-layout">
      <GlobalRail principal={principal} onLogout={onLogout} current="search" />
      <main className="search-surface panel">
        <header className="search-header">
          <p className="eyebrow">WORKSPACE SEARCH</p>
          <h1>Find anything you wrote.</h1>
          <p>Search document names, paths and Markdown without leaving this workspace.</p>
        </header>
        <form className="search-form" onSubmit={submit}>
          <label htmlFor="workspace-search">Search terms</label>
          <div className="search-input-row">
            <input
              id="workspace-search"
              type="search"
              maxLength={500}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Markdown…"
            />
            <button className="primary-action" type="submit">
              Search
            </button>
          </div>
          <div className="search-filters">
            <label>
              Scope
              <select
                aria-label="Search scope"
                value={scope}
                onChange={(event) => setScope(event.target.value as SearchFilters["scope"])}
              >
                <option value="all">Entire workspace</option>
                <option value="folder">Selected folder</option>
                <option value="subtree">Folder and descendants</option>
              </select>
            </label>
            {scope !== "all" ? (
              <label>
                Folder
                <select
                  aria-label="Search folder"
                  required
                  value={folderId}
                  onChange={(event) => setFolderId(event.target.value)}
                >
                  <option value="">Choose a folder</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {`${"— ".repeat(folder.depth)}${folder.name}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="search-checkbox">
              <input
                type="checkbox"
                checked={includeCodeBlocks}
                onChange={(event) => setIncludeCodeBlocks(event.target.checked)}
              />
              Include code blocks
            </label>
          </div>
        </form>

        {searchQuery.isPending && filters ? <p role="status">Searching…</p> : null}
        {searchQuery.isError ? (
          <div className="search-message" role="alert">
            <p>{searchQuery.error.message} Your query and scope are unchanged.</p>
            <button
              className="secondary-action"
              type="button"
              onClick={() => searchQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : null}
        {!filters ? (
          <div className="search-message">
            <strong>Start with a title, phrase or CJK substring.</strong>
            <p>Use Ctrl/Cmd+P when you already know the document name.</p>
          </div>
        ) : null}
        {filters && searchQuery.isSuccess && results.length === 0 ? (
          <div className="search-message">
            <strong>No matching documents.</strong>
            <p>Try fewer terms, a wider scope, or include code blocks.</p>
          </div>
        ) : null}
        {results.length > 0 ? (
          <section aria-live="polite" aria-label="Search results">
            <p className="search-count">{results.length} results loaded</p>
            <ol className="search-results">
              {results.map((result) => (
                <li key={result.documentId}>
                  <Link to={`/documents/${result.documentId}`}>
                    <strong>{result.name}</strong>
                    <span>{result.path}</span>
                    <p>{result.snippet}</p>
                    <small>{result.matchHints.join(" · ")}</small>
                  </Link>
                </li>
              ))}
            </ol>
            {searchQuery.hasNextPage ? (
              <button
                className="secondary-action search-more"
                type="button"
                disabled={searchQuery.isFetchingNextPage}
                onClick={() => searchQuery.fetchNextPage()}
              >
                {searchQuery.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}

function rememberSearch(query: string): void {
  const key = "markora.search-history.v1";
  try {
    const current = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    const history = Array.isArray(current)
      ? current.filter((item): item is string => typeof item === "string" && item !== query)
      : [];
    localStorage.setItem(key, JSON.stringify([query, ...history].slice(0, 20)));
  } catch {
    localStorage.setItem(key, JSON.stringify([query]));
  }
}
