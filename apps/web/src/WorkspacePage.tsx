import type {
  DocumentDetail,
  DocumentSummary,
  FolderTreeNode,
  Principal,
} from "@markora/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DocumentWorkspace } from "./DocumentWorkspace.js";
import { dispatchPortability, PortabilityCenter } from "./PortabilityCenter.js";
import { readPreferenceSettings } from "./preferences.js";
import {
  bulkDocuments,
  createDocument,
  createFolder,
  getDocument,
  getDocuments,
  getFolderTree,
  trashDocument,
  trashFolder,
  updateDocument,
  updateFolder,
} from "./workspace-api.js";

interface WorkspacePageProps {
  readonly principal: Principal;
  readonly onLogout: () => void | Promise<void>;
}

type Action =
  | { kind: "create-folder" }
  | { kind: "create-document" }
  | { kind: "rename-folder"; folder: FlatFolder }
  | { kind: "move-folder"; folder: FlatFolder }
  | { kind: "trash-folder"; folder: FlatFolder }
  | { kind: "rename-document"; document: DocumentDetail }
  | { kind: "move-document"; document: DocumentDetail }
  | { kind: "trash-document"; document: DocumentDetail }
  | { kind: "bulk-move" }
  | { kind: "bulk-trash" };

export interface FlatFolder {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly documentCount: number;
  readonly updatedAt: string;
  readonly depth: number;
}

export function flattenFolders(nodes: readonly FolderTreeNode[], depth = 0): FlatFolder[] {
  const flattened: FlatFolder[] = [];
  for (const node of nodes) {
    flattened.push({
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      documentCount: node.documentCount,
      updatedAt: node.updatedAt,
      depth,
    });
    flattened.push(...flattenFolders(node.children, depth + 1));
  }
  return flattened;
}

export function WorkspacePage({ principal, onLogout }: WorkspacePageProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { documentId } = useParams<{ documentId: string }>();
  const workspacePreferences = readPreferenceSettings();
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(() =>
    workspacePreferences.restoreLastWorkspaceState
      ? (localStorage.getItem("markora.last-folder.v1") ?? null)
      : null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mobilePane, setMobilePane] = useState<"folders" | "documents" | "editor">(
    documentId ? "editor" : "documents",
  );
  const [action, setAction] = useState<Action | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unsyncedDocumentId, setUnsyncedDocumentId] = useState<string | null>(null);
  const handleUnsyncedChange = useCallback((id: string | null) => setUnsyncedDocumentId(id), []);

  const treeQuery = useQuery({ queryKey: ["folders", "tree"], queryFn: getFolderTree });
  const folders = useMemo(() => flattenFolders(treeQuery.data?.data ?? []), [treeQuery.data]);
  const documentsQuery = useQuery({
    queryKey: ["documents", selectedFolderId],
    queryFn: () => getDocuments(selectedFolderId),
  });
  useEffect(() => {
    if (treeQuery.data && selectedFolderId && !folders.some(({ id }) => id === selectedFolderId)) {
      setSelectedFolderId(null);
      localStorage.removeItem("markora.last-folder.v1");
    }
  }, [folders, selectedFolderId, treeQuery.data]);
  const visibleDocuments = useMemo(() => {
    const settings = readPreferenceSettings();
    const documents = [...(documentsQuery.data?.data ?? [])];
    documents.sort((left, right) => {
      const compared =
        settings.documentSort === "NAME"
          ? left.name.localeCompare(right.name)
          : left.updatedAt.localeCompare(right.updatedAt);
      return settings.documentDirection === "ASC" ? compared : -compared;
    });
    return documents;
  }, [documentsQuery.data]);
  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => getDocument(documentId ?? ""),
    enabled: Boolean(documentId),
    retry: false,
  });

  useEffect(() => {
    if (documentId && documentQuery.error) {
      const error = documentQuery.error as { code?: string };
      if (error.code === "NOT_FOUND") navigate("/", { replace: true });
    }
  }, [documentId, documentQuery.error, navigate]);

  useEffect(() => {
    if (documentQuery.data) {
      setSelectedFolderId(documentQuery.data.folderId);
      setSelectedIds(new Set());
      setMobilePane("editor");
    }
  }, [documentQuery.data]);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<string>).detail;
      setActionError(null);
      if (command === "new-document") setAction({ kind: "create-document" });
      if (command === "new-folder") setAction({ kind: "create-folder" });
      if (command === "import") {
        dispatchPortability({ kind: "import", targetFolderId: selectedFolderId });
      }
      if (command === "export-workspace") {
        dispatchPortability({
          kind: "export",
          request: { scope: "workspace", idempotencyKey: crypto.randomUUID() },
        });
      }
    };
    window.addEventListener("markora:workspace-command", onCommand);
    return () => window.removeEventListener("markora:workspace-command", onCommand);
  }, [selectedFolderId]);

  useEffect(() => {
    const onOpenDocument = (event: Event) => {
      const openEvent = event as CustomEvent<string>;
      openEvent.preventDefault();
      if (
        unsyncedDocumentId &&
        unsyncedDocumentId !== openEvent.detail &&
        !window.confirm(
          "This document has an unsynced local draft. Leave it open in local recovery storage and continue?",
        )
      ) {
        return;
      }
      navigate(`/documents/${openEvent.detail}`);
    };
    window.addEventListener("markora:open-document", onOpenDocument);
    return () => window.removeEventListener("markora:open-document", onOpenDocument);
  }, [navigate, unsyncedDocumentId]);

  const invalidateNavigation = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["folders", "tree"] }),
      queryClient.invalidateQueries({ queryKey: ["documents"] }),
      queryClient.invalidateQueries({ queryKey: ["document"] }),
    ]);
  }, [queryClient]);

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => createFolder(selectedFolderId, name),
    onSuccess: async () => {
      setAction(null);
      await invalidateNavigation();
    },
    onError: (error) => setActionError(error.message),
  });
  const createDocumentMutation = useMutation({
    mutationFn: (name: string) => createDocument(selectedFolderId, name),
    onSuccess: async (document) => {
      setAction(null);
      await invalidateNavigation();
      navigateToDocument(document.id);
    },
    onError: (error) => setActionError(error.message),
  });
  const folderMutation = useMutation({
    mutationFn: ({
      folder,
      change,
    }: {
      folder: FlatFolder;
      change: { name?: string; parentId?: string | null };
    }) => updateFolder(folder.id, { ...change, expectedUpdatedAt: folder.updatedAt }),
    onMutate: async ({ folder, change }) => {
      await queryClient.cancelQueries({ queryKey: ["folders", "tree"] });
      const previous = queryClient.getQueryData(["folders", "tree"]);
      queryClient.setQueryData(["folders", "tree"], (value: unknown) =>
        optimisticFolderUpdate(value, folder.id, change),
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(["folders", "tree"], context?.previous);
      setActionError(`${error.message} No folder changes were saved.`);
    },
    onSuccess: () => setAction(null),
    onSettled: invalidateNavigation,
  });
  const folderTrashMutation = useMutation({
    mutationFn: (folder: FlatFolder) => trashFolder(folder.id),
    onMutate: async (folder) => {
      await queryClient.cancelQueries({ queryKey: ["folders", "tree"] });
      const previous = queryClient.getQueryData(["folders", "tree"]);
      queryClient.setQueryData(["folders", "tree"], (value: unknown) =>
        optimisticFolderRemoval(value, folder.id),
      );
      return { previous };
    },
    onError: (error, _folder, context) => {
      queryClient.setQueryData(["folders", "tree"], context?.previous);
      setActionError(`${error.message} The folder remains in place.`);
    },
    onSuccess: (_value, folder) => {
      if (selectedFolderId === folder.id) setSelectedFolderId(null);
      setAction(null);
    },
    onSettled: invalidateNavigation,
  });
  const documentMutation = useMutation({
    mutationFn: ({
      document,
      change,
    }: {
      document: DocumentDetail;
      change: { name?: string; folderId?: string | null };
    }) => updateDocument(document.id, { ...change, expectedUpdatedAt: document.updatedAt }),
    onMutate: async ({ document, change }) => {
      await queryClient.cancelQueries({ queryKey: ["document", document.id] });
      const previous = queryClient.getQueryData(["document", document.id]);
      queryClient.setQueryData(["document", document.id], { ...document, ...change });
      return { previous };
    },
    onError: (error, variables, context) => {
      queryClient.setQueryData(["document", variables.document.id], context?.previous);
      setActionError(`${error.message} Your document metadata is unchanged.`);
    },
    onSuccess: (document) => {
      queryClient.setQueryData(["document", document.id], document);
      setSelectedFolderId(document.folderId);
      setAction(null);
    },
    onSettled: invalidateNavigation,
  });
  const documentTrashMutation = useMutation({
    mutationFn: (document: DocumentDetail) => trashDocument(document.id),
    onMutate: async (document) => {
      await queryClient.cancelQueries({ queryKey: ["documents", document.folderId] });
      const previous = queryClient.getQueryData(["documents", document.folderId]);
      queryClient.setQueryData(
        ["documents", document.folderId],
        optimisticDocumentRemoval(previous, document.id),
      );
      return { previous };
    },
    onError: (error, document, context) => {
      queryClient.setQueryData(["documents", document.folderId], context?.previous);
      setActionError(`${error.message} The document remains available.`);
    },
    onSuccess: async (_value, document) => {
      setAction(null);
      if (documentId === document.id) navigate("/");
      await invalidateNavigation();
    },
  });
  const bulkMutation = useMutation({
    mutationFn: async (variables: {
      operation: "MOVE" | "TRASH";
      targetFolderId?: string | null;
    }) =>
      bulkDocuments({
        operation: variables.operation,
        documentIds: [...selectedIds],
        ...(variables.targetFolderId !== undefined
          ? { targetFolderId: variables.targetFolderId }
          : {}),
      }),
    onSuccess: async (result, variables) => {
      const failed = result.data.filter((item) => !item.success);
      if (
        variables.operation === "TRASH" &&
        documentId &&
        result.data.some((item) => item.documentId === documentId && item.success)
      ) {
        navigate("/");
      }
      setAction(null);
      setSelectedIds(new Set());
      setActionError(
        failed.length > 0
          ? `${result.data.length - failed.length} changed; ${failed.length} failed and were left unchanged.`
          : null,
      );
      await invalidateNavigation();
    },
    onError: (error) => setActionError(`${error.message} The selected documents were not changed.`),
  });

  const currentFolder = folders.find((folder) => folder.id === selectedFolderId);
  return (
    <div className={`app-shell workspace-shell mobile-pane-${mobilePane}`}>
      <GlobalRail
        principal={principal}
        onLogout={onLogout}
        current="documents"
        onNewDocument={() => openAction({ kind: "create-document" })}
      />
      <nav className="mobile-pane-tabs" aria-label="Workspace panes">
        <button
          type="button"
          aria-current={mobilePane === "folders" ? "page" : undefined}
          onClick={() => setMobilePane("folders")}
        >
          Folders
        </button>
        <button
          type="button"
          aria-current={mobilePane === "documents" ? "page" : undefined}
          onClick={() => setMobilePane("documents")}
        >
          Documents
        </button>
        {documentId ? (
          <button
            type="button"
            aria-current={mobilePane === "editor" ? "page" : undefined}
            onClick={() => setMobilePane("editor")}
          >
            Editor
          </button>
        ) : null}
      </nav>
      <aside className="folder-drawer panel" aria-labelledby="folders-heading">
        <div className="panel-heading">
          <h2 id="folders-heading">My Documents</h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Create folder"
            onClick={() => openAction({ kind: "create-folder" })}
          >
            ＋
          </button>
        </div>
        <div className="folder-scroll-region">
          {treeQuery.isPending ? (
            <p className="panel-status" role="status">
              Loading folders…
            </p>
          ) : null}
          {treeQuery.isError ? (
            <PanelError message={treeQuery.error.message} retry={() => treeQuery.refetch()} />
          ) : null}
          {treeQuery.data ? (
            <nav aria-label="Folders">
              <ul className="tree">
                <li>
                  <button
                    className={selectedFolderId === null ? "tree-root selected" : "tree-root"}
                    type="button"
                    aria-current={selectedFolderId === null ? "page" : undefined}
                    onClick={() => selectFolder(null)}
                  >
                    ⌂　Workspace root
                  </button>
                </li>
                {treeQuery.data.data.map((folder) => (
                  <FolderTreeItem
                    key={folder.id}
                    folder={folder}
                    selectedId={selectedFolderId}
                    onSelect={selectFolder}
                    rememberExpanded={workspacePreferences.rememberExpandedFolders ?? true}
                  />
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      </aside>

      <aside className="document-drawer panel" aria-labelledby="documents-heading">
        <div className="document-heading">
          <p>{currentFolder ? currentFolder.name : "Workspace root"}</p>
          <div className="panel-heading">
            <h2 id="documents-heading">{documentsQuery.data?.data.length ?? 0} documents</h2>
            <span className="heading-actions">
              <button
                className="icon-button"
                type="button"
                aria-label="Import Markdown"
                onClick={() =>
                  dispatchPortability({ kind: "import", targetFolderId: selectedFolderId })
                }
              >
                ⇧
              </button>
              <button
                className="icon-button accent"
                type="button"
                aria-label="Create document"
                onClick={() => openAction({ kind: "create-document" })}
              >
                ＋
              </button>
            </span>
          </div>
          {currentFolder ? (
            <div className="context-actions" role="toolbar" aria-label="Folder actions">
              <button
                type="button"
                onClick={() => openAction({ kind: "rename-folder", folder: currentFolder })}
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => openAction({ kind: "move-folder", folder: currentFolder })}
              >
                Move
              </button>
              <button
                type="button"
                onClick={() => openAction({ kind: "trash-folder", folder: currentFolder })}
              >
                Trash
              </button>
              <button
                type="button"
                onClick={() =>
                  dispatchPortability({
                    kind: "export",
                    request: {
                      scope: "folder",
                      folderId: currentFolder.id,
                      idempotencyKey: crypto.randomUUID(),
                    },
                  })
                }
              >
                Export folder
              </button>
            </div>
          ) : null}
        </div>
        {selectedIds.size > 0 ? (
          <div className="selection-bar" role="toolbar" aria-label="Selected documents">
            <strong>{selectedIds.size} selected</strong>
            <button type="button" onClick={() => openAction({ kind: "bulk-move" })}>
              Move
            </button>
            <button
              type="button"
              onClick={() =>
                dispatchPortability({
                  kind: "export",
                  request: {
                    scope: "selection",
                    ids: [...selectedIds],
                    idempotencyKey: crypto.randomUUID(),
                  },
                })
              }
            >
              Export
            </button>
            <button type="button" onClick={() => openAction({ kind: "bulk-trash" })}>
              Trash
            </button>
          </div>
        ) : null}
        <div className="document-scroll-region">
          {documentsQuery.isPending ? (
            <p className="panel-status" role="status">
              Loading documents…
            </p>
          ) : null}
          {documentsQuery.isError ? (
            <PanelError
              message={documentsQuery.error.message}
              retry={() => documentsQuery.refetch()}
            />
          ) : null}
          {documentsQuery.data?.data.length === 0 ? (
            <div className="empty-panel">
              <p>No documents here yet.</p>
              <button
                className="primary-action"
                type="button"
                onClick={() => openAction({ kind: "create-document" })}
              >
                New Document
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={() =>
                  dispatchPortability({ kind: "import", targetFolderId: selectedFolderId })
                }
              >
                Import Markdown
              </button>
            </div>
          ) : null}
          <ul className="document-list">
            {visibleDocuments.map((document) => (
              <li
                key={document.id}
                className={documentId === document.id ? "active-document" : undefined}
              >
                <label className="document-check">
                  <input
                    type="checkbox"
                    aria-label={`Select ${document.name}`}
                    checked={selectedIds.has(document.id)}
                    onChange={() => toggleSelected(document.id)}
                  />
                </label>
                <button
                  className={documentId === document.id ? "selected" : undefined}
                  type="button"
                  onClick={() => navigateToDocument(document.id)}
                >
                  <span className="document-icon" aria-hidden="true">
                    ▤
                  </span>
                  <span>
                    <strong>{document.name}</strong>
                    <small>{formatRelative(document.updatedAt)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main
        className="work-surface"
        id="documents"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          dispatchPortability({
            kind: "import",
            files: [...event.dataTransfer.files],
            targetFolderId: selectedFolderId,
          });
        }}
      >
        {actionError && !action ? (
          <div className="operation-notice" role="alert">
            {actionError}
            <button type="button" aria-label="Dismiss error" onClick={() => setActionError(null)}>
              ×
            </button>
          </div>
        ) : null}
        {documentQuery.isPending && documentId ? (
          <div className="document-loading" role="status">
            Opening document…
          </div>
        ) : null}
        {documentQuery.isError ? (
          <PanelError
            message={`${documentQuery.error.message} The current list and folders are still available.`}
            retry={() => documentQuery.refetch()}
          />
        ) : null}
        {documentQuery.data ? (
          <DocumentSurface
            document={documentQuery.data}
            onAction={openAction}
            onUnsyncedChange={handleUnsyncedChange}
          />
        ) : !documentId ? (
          <div className="workspace-empty">
            <p className="eyebrow">MARKORA V1</p>
            <h1>Choose a document, or begin a new one.</h1>
            <p>Your folders and Markdown live in this private workspace.</p>
            <button
              className="primary-action"
              type="button"
              onClick={() => openAction({ kind: "create-document" })}
            >
              ＋ New Document
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() =>
                dispatchPortability({ kind: "import", targetFolderId: selectedFolderId })
              }
            >
              Import Markdown
            </button>
            <small>or drop Markdown files here</small>
          </div>
        ) : null}
      </main>

      {action ? (
        <ActionDialog
          action={action}
          folders={folders}
          busy={
            createFolderMutation.isPending ||
            createDocumentMutation.isPending ||
            folderMutation.isPending ||
            folderTrashMutation.isPending ||
            documentMutation.isPending ||
            documentTrashMutation.isPending ||
            bulkMutation.isPending
          }
          error={actionError}
          onCancel={() => {
            setAction(null);
            setActionError(null);
          }}
          onSubmit={(value) => {
            setActionError(null);
            if (action.kind === "create-folder") createFolderMutation.mutate(value.name ?? "");
            if (action.kind === "create-document") createDocumentMutation.mutate(value.name ?? "");
            if (action.kind === "rename-folder")
              folderMutation.mutate({
                folder: action.folder,
                change: { name: value.name ?? "" },
              });
            if (action.kind === "move-folder")
              folderMutation.mutate({
                folder: action.folder,
                change: { parentId: value.folderId ?? null },
              });
            if (action.kind === "trash-folder") folderTrashMutation.mutate(action.folder);
            if (action.kind === "rename-document")
              documentMutation.mutate({
                document: action.document,
                change: { name: value.name ?? "" },
              });
            if (action.kind === "move-document")
              documentMutation.mutate({
                document: action.document,
                change: { folderId: value.folderId ?? null },
              });
            if (action.kind === "trash-document") documentTrashMutation.mutate(action.document);
            if (action.kind === "bulk-move")
              bulkMutation.mutate({
                operation: "MOVE",
                targetFolderId: value.folderId ?? null,
              });
            if (action.kind === "bulk-trash") bulkMutation.mutate({ operation: "TRASH" });
          }}
        />
      ) : null}
      <PortabilityCenter onImported={invalidateNavigation} />
    </div>
  );

  function openAction(next: Action) {
    setActionError(null);
    setAction(next);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectFolder(id: string | null) {
    setSelectedFolderId(id);
    if (workspacePreferences.restoreLastWorkspaceState) {
      if (id) localStorage.setItem("markora.last-folder.v1", id);
      else localStorage.removeItem("markora.last-folder.v1");
    }
    setSelectedIds(new Set());
    setMobilePane("documents");
  }

  function navigateToDocument(id: string) {
    if (
      unsyncedDocumentId &&
      unsyncedDocumentId !== id &&
      !window.confirm(
        "This document has an unsynced local draft. Leave it open in local recovery storage and continue?",
      )
    ) {
      return;
    }
    setMobilePane("editor");
    navigate(`/documents/${id}`);
  }
}

export function GlobalRail({
  principal,
  onLogout,
  current,
  onNewDocument,
}: {
  readonly principal: Principal;
  readonly onLogout: () => void | Promise<void>;
  readonly current: "documents" | "search" | "trash" | "settings" | "admin";
  readonly onNewDocument?: () => void;
}) {
  return (
    <nav className="global-rail panel" aria-label="Global navigation">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          M
        </span>
        <span>
          <strong>Markora</strong>
          <small>{principal.displayName}</small>
        </span>
      </div>
      <ul className="global-links">
        <li>
          <Link
            className={current === "documents" ? "active" : undefined}
            to="/"
            aria-label="Documents"
          >
            ▤ <span>Documents</span>
          </Link>
        </li>
        <li>
          <Link
            className={current === "search" ? "active" : undefined}
            to="/search"
            aria-label="Search"
          >
            ⌕ <span>Search</span>
          </Link>
        </li>
        <li>
          <Link
            className={current === "trash" ? "active" : undefined}
            to="/trash"
            aria-label="Trash"
          >
            ♲ <span>Trash</span>
          </Link>
        </li>
        <li>
          <Link
            className={current === "settings" ? "active" : undefined}
            to="/settings/sessions"
            aria-label="Settings"
          >
            ⚙ <span>Settings</span>
          </Link>
        </li>
        {principal.role === "ADMIN" ? (
          <li>
            <Link
              className={current === "admin" ? "active" : undefined}
              to="/admin/overview"
              aria-label="Admin"
            >
              ◈ <span>Admin</span>
            </Link>
          </li>
        ) : null}
      </ul>
      <div className="rail-footer">
        <button className="secondary-action" type="button" onClick={onLogout}>
          Sign out
        </button>
        {onNewDocument ? (
          <button className="primary-action" type="button" onClick={onNewDocument}>
            ＋ New Document
          </button>
        ) : null}
      </div>
    </nav>
  );
}

function FolderTreeItem({
  folder,
  selectedId,
  onSelect,
  rememberExpanded,
}: {
  readonly folder: FolderTreeNode;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly rememberExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(() =>
    rememberExpanded ? !readCollapsedFolders().has(folder.id) : true,
  );
  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (!rememberExpanded) return;
    const ids = readCollapsedFolders();
    if (next) ids.delete(folder.id);
    else ids.add(folder.id);
    localStorage.setItem("markora.collapsed-folders.v1", JSON.stringify([...ids]));
  }
  return (
    <li>
      {folder.children.length > 0 ? (
        <button
          className="tree-expander"
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${folder.name}`}
          aria-expanded={expanded}
          onClick={toggle}
        >
          {expanded ? "⌄" : "›"}
        </button>
      ) : null}
      <button
        className={selectedId === folder.id ? "selected" : undefined}
        type="button"
        aria-current={selectedId === folder.id ? "page" : undefined}
        onClick={() => onSelect(folder.id)}
      >
        <span>▢ {folder.name}</span>
        <small title={`${folder.documentCount} recursive documents`}>{folder.documentCount}</small>
      </button>
      {folder.children.length > 0 && expanded ? (
        <ul>
          {folder.children.map((child) => (
            <FolderTreeItem
              key={child.id}
              folder={child}
              selectedId={selectedId}
              onSelect={onSelect}
              rememberExpanded={rememberExpanded}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function readCollapsedFolders(): Set<string> {
  try {
    const value = JSON.parse(
      localStorage.getItem("markora.collapsed-folders.v1") ?? "[]",
    ) as unknown;
    return new Set(
      Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function DocumentSurface({
  document,
  onAction,
  onUnsyncedChange,
}: {
  readonly document: DocumentDetail;
  readonly onAction: (action: Action) => void;
  readonly onUnsyncedChange: (documentId: string | null) => void;
}) {
  return (
    <DocumentWorkspace
      key={document.id}
      document={document}
      onMetadataAction={(kind) =>
        onAction(
          kind === "rename"
            ? { kind: "rename-document", document }
            : kind === "move"
              ? { kind: "move-document", document }
              : { kind: "trash-document", document },
        )
      }
      onUnsyncedChange={onUnsyncedChange}
    />
  );
}

function ActionDialog({
  action,
  folders,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  readonly action: Action;
  readonly folders: readonly FlatFolder[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onSubmit: (value: { name?: string; folderId?: string | null }) => void;
}) {
  const nameAction =
    action.kind === "create-folder" ||
    action.kind === "create-document" ||
    action.kind === "rename-folder" ||
    action.kind === "rename-document";
  const documentNameAction = action.kind === "create-document" || action.kind === "rename-document";
  const moveAction =
    action.kind === "move-folder" || action.kind === "move-document" || action.kind === "bulk-move";
  const initialName =
    action.kind === "rename-folder"
      ? action.folder.name
      : action.kind === "rename-document"
        ? action.document.name
        : "";
  const [name, setName] = useState(initialName);
  const [folderId, setFolderId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const title = dialogTitle(action);
  useEffect(() => {
    if (nameAction) inputRef.current?.focus();
    else if (moveAction) selectRef.current?.focus();
  }, [moveAction, nameAction]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(nameAction ? { name } : moveAction ? { folderId } : {});
  }
  return (
    <div className="dialog-backdrop">
      <section
        className="action-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-dialog-title"
      >
        <form onSubmit={submit}>
          <h2 id="action-dialog-title">{title}</h2>
          {nameAction ? (
            <>
              <label htmlFor="item-name">Name</label>
              <input
                ref={inputRef}
                id="item-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              {documentNameAction ? (
                <p className="field-hint">
                  Document names must use a safe <code>.md</code> filename.
                </p>
              ) : null}
            </>
          ) : null}
          {moveAction ? (
            <>
              <label htmlFor="target-folder">Destination</label>
              <select
                ref={selectRef}
                id="target-folder"
                value={folderId ?? "root"}
                onChange={(event) =>
                  setFolderId(event.target.value === "root" ? null : event.target.value)
                }
              >
                <option value="root">Workspace root</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {"  ".repeat(folder.depth)}
                    {folder.name}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {action.kind === "trash-folder" ||
          action.kind === "trash-document" ||
          action.kind === "bulk-trash" ? (
            <p>
              The item will leave active navigation. Its Markdown remains recoverable from Trash.
            </p>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button className="secondary-action" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button className="primary-action" type="submit" disabled={busy}>
              {busy ? "Saving…" : action.kind.includes("trash") ? "Move to Trash" : "Save"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function dialogTitle(action: Action): string {
  const titles: Record<Action["kind"], string> = {
    "create-folder": "Create folder",
    "create-document": "Create document",
    "rename-folder": "Rename folder",
    "move-folder": "Move folder",
    "trash-folder": "Move folder to Trash?",
    "rename-document": "Rename document",
    "move-document": "Move document",
    "trash-document": "Move document to Trash?",
    "bulk-move": "Move selected documents",
    "bulk-trash": "Move selected documents to Trash?",
  };
  return titles[action.kind];
}

function PanelError({ message, retry }: { readonly message: string; readonly retry: () => void }) {
  return (
    <div className="panel-error" role="alert">
      <p>{message}</p>
      <button type="button" onClick={retry}>
        Try again
      </button>
    </div>
  );
}

function formatRelative(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function optimisticFolderUpdate(
  value: unknown,
  folderId: string,
  change: { name?: string; parentId?: string | null },
): unknown {
  if (!value || typeof value !== "object" || !("data" in value) || !Array.isArray(value.data))
    return value;
  const roots = structuredClone(value.data) as FolderTreeNode[];
  let moved: FolderTreeNode | undefined;
  const remove = (nodes: FolderTreeNode[]): FolderTreeNode[] =>
    nodes.filter((node) => {
      if (node.id === folderId) {
        moved = {
          ...node,
          name: change.name ?? node.name,
          parentId: change.parentId === undefined ? node.parentId : change.parentId,
        };
        return false;
      }
      node.children = remove(node.children);
      return true;
    });
  const next = remove(roots);
  if (!moved) return value;
  if (change.parentId === undefined)
    return { ...value, data: insertAtParent(next, moved, moved.parentId) };
  return { ...value, data: insertAtParent(next, moved, change.parentId) };
}

function insertAtParent(
  nodes: FolderTreeNode[],
  folder: FolderTreeNode,
  parentId: string | null,
): FolderTreeNode[] {
  if (parentId === null) return [...nodes, folder];
  return nodes.map((node) =>
    node.id === parentId
      ? { ...node, children: [...node.children, folder] }
      : { ...node, children: insertAtParent(node.children, folder, parentId) },
  );
}

function optimisticFolderRemoval(value: unknown, folderId: string): unknown {
  if (!value || typeof value !== "object" || !("data" in value) || !Array.isArray(value.data))
    return value;
  const remove = (nodes: FolderTreeNode[]): FolderTreeNode[] =>
    nodes
      .filter((node) => node.id !== folderId)
      .map((node) => ({ ...node, children: remove(node.children) }));
  return { ...value, data: remove(value.data as FolderTreeNode[]) };
}

function optimisticDocumentRemoval(value: unknown, documentId: string): unknown {
  if (!value || typeof value !== "object" || !("data" in value) || !Array.isArray(value.data)) {
    return value;
  }
  return {
    ...value,
    data: (value.data as DocumentSummary[]).filter((document) => document.id !== documentId),
  };
}
