import type { Principal, QuickOpenItem } from "@markora/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { quickOpenDocuments } from "./workspace-api.js";

type OverlayMode = "quick-open" | "commands";

interface CommandItem {
  readonly id: string;
  readonly group: "Navigation" | "Create" | "Editor" | "Portability";
  readonly label: string;
  readonly detail: string;
  readonly run: () => void;
}

export function GlobalCommandCenter({ principal }: { readonly principal: Principal }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<OverlayMode | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const inWorkspace = location.pathname === "/" || location.pathname.startsWith("/documents/");
  const inDocument = location.pathname.startsWith("/documents/");

  const close = () => {
    setMode(null);
    const target = returnFocusRef.current;
    requestAnimationFrame(() => target?.focus());
  };
  const open = useCallback((nextMode: OverlayMode) => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActiveIndex(0);
    setMode(nextMode);
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLocaleLowerCase();
      if (key === "p" && !event.shiftKey) {
        event.preventDefault();
        open("quick-open");
      } else if (key === "k" && !event.shiftKey) {
        event.preventDefault();
        open("commands");
      } else if (key === "f" && event.shiftKey) {
        event.preventDefault();
        setMode(null);
        navigate("/search");
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [navigate, open]);

  useEffect(() => {
    if (!mode) return;
    inputRef.current?.focus();
  }, [mode]);

  const quickQuery = useQuery({
    queryKey: ["quick-open", query],
    queryFn: () => quickOpenDocuments(query),
    enabled: mode === "quick-open",
    retry: false,
  });
  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      {
        id: "documents",
        group: "Navigation",
        label: "Go to Documents",
        detail: "Workspace document browser",
        run: () => navigate("/"),
      },
      {
        id: "search",
        group: "Navigation",
        label: "Search workspace",
        detail: "Names, paths and Markdown",
        run: () => navigate("/search"),
      },
      {
        id: "trash",
        group: "Navigation",
        label: "Go to Trash",
        detail: "Restore or permanently delete",
        run: () => navigate("/trash"),
      },
      {
        id: "sessions",
        group: "Navigation",
        label: "Manage sessions",
        detail: "Personal security settings",
        run: () => navigate("/settings/sessions"),
      },
    ];
    if (inWorkspace) {
      items.push(
        {
          id: "new-document",
          group: "Create",
          label: "Create document",
          detail: "In the selected folder",
          run: () => dispatchWorkspaceCommand("new-document"),
        },
        {
          id: "new-folder",
          group: "Create",
          label: "Create folder",
          detail: "In the selected folder",
          run: () => dispatchWorkspaceCommand("new-folder"),
        },
        {
          id: "import",
          group: "Portability",
          label: "Import Markdown",
          detail: "Files, folders or a ZIP archive",
          run: () => dispatchWorkspaceCommand("import"),
        },
        {
          id: "export-workspace",
          group: "Portability",
          label: "Export workspace",
          detail: "Portable Markdown hierarchy",
          run: () => dispatchWorkspaceCommand("export-workspace"),
        },
      );
    }
    if (inDocument) {
      items.push({
        id: "focus-editor",
        group: "Editor",
        label: "Focus editor",
        detail: "Return to the current document",
        run: focusEditor,
      });
    }
    if (principal.role !== "ADMIN") return items.filter((item) => item.id !== "admin");
    return items;
  }, [inDocument, inWorkspace, navigate, principal.role]);
  const filteredCommands = commands.filter((item) =>
    `${item.label} ${item.detail} ${item.group}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const quickItems = quickQuery.data?.data ?? [];
  const itemCount = mode === "quick-open" ? quickItems.length : filteredCommands.length;

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, itemCount - 1)));
  }, [itemCount]);

  if (!mode) return null;

  const activate = (index: number) => {
    if (mode === "quick-open") {
      const item = quickItems[index];
      if (!item) return;
      const openEvent = new CustomEvent<string>("markora:open-document", {
        detail: item.documentId,
        cancelable: true,
      });
      window.dispatchEvent(openEvent);
      if (!openEvent.defaultPrevented) navigate(`/documents/${item.documentId}`);
    } else {
      const item = filteredCommands[index];
      if (!item) return;
      item.run();
    }
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        (current) => (current + direction + Math.max(1, itemCount)) % Math.max(1, itemCount),
      );
      return;
    }
    if (event.key === "Enter" && event.target === inputRef.current) {
      event.preventDefault();
      activate(activeIndex);
      return;
    }
    if (event.key === "Tab") trapTab(event, dialogRef.current);
  };

  return (
    <div className="command-backdrop">
      <div
        ref={dialogRef}
        className="command-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-heading"
        onKeyDown={onKeyDown}
      >
        <header>
          <strong id="command-heading">
            {mode === "quick-open" ? "Quick Open" : "Command Palette"}
          </strong>
          <kbd>{mode === "quick-open" ? "Ctrl P" : "Ctrl K"}</kbd>
        </header>
        <input
          ref={inputRef}
          type="search"
          aria-label={mode === "quick-open" ? "Find a document" : "Find a command"}
          placeholder={mode === "quick-open" ? "Document name or path…" : "Type a command…"}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
        />
        <div className="command-results" role="listbox" aria-label="Available actions">
          {mode === "quick-open" ? (
            <QuickOpenResults
              items={quickItems}
              activeIndex={activeIndex}
              pending={quickQuery.isPending}
              error={quickQuery.isError}
              onActivate={activate}
              onPoint={setActiveIndex}
            />
          ) : (
            filteredCommands.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activate(index)}
              >
                <span>
                  <small>{item.group}</small>
                  <strong>{item.label}</strong>
                </span>
                <span>{item.detail}</span>
              </button>
            ))
          )}
          {!quickQuery.isPending && itemCount === 0 ? (
            <p>No matching {mode === "quick-open" ? "documents" : "commands"}.</p>
          ) : null}
        </div>
        <footer>↑↓ select · Enter open · Esc close</footer>
      </div>
    </div>
  );
}

function QuickOpenResults({
  items,
  activeIndex,
  pending,
  error,
  onActivate,
  onPoint,
}: {
  readonly items: readonly QuickOpenItem[];
  readonly activeIndex: number;
  readonly pending: boolean;
  readonly error: boolean;
  readonly onActivate: (index: number) => void;
  readonly onPoint: (index: number) => void;
}) {
  if (pending) return <p role="status">Finding documents…</p>;
  if (error) return <p role="alert">Quick Open could not load. Close and try again.</p>;
  return items.map((item, index) => (
    <button
      key={item.documentId}
      type="button"
      role="option"
      aria-selected={index === activeIndex}
      onMouseEnter={() => onPoint(index)}
      onClick={() => onActivate(index)}
    >
      <span>
        <strong>{item.name}</strong>
        <small>{item.path}</small>
      </span>
    </button>
  ));
}

function dispatchWorkspaceCommand(
  command: "new-document" | "new-folder" | "import" | "export-workspace",
) {
  window.dispatchEvent(new CustomEvent("markora:workspace-command", { detail: command }));
}

function focusEditor() {
  requestAnimationFrame(() => {
    const editor = document.querySelector<HTMLElement>(
      ".source-editor .cm-content, .wysiwyg-editor [contenteditable='true']",
    );
    editor?.focus();
  });
}

function trapTab(event: React.KeyboardEvent, dialog: HTMLElement | null) {
  if (!dialog) return;
  const focusable = [
    ...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"),
  ];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
