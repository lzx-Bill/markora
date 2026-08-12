import type { DocumentDetail } from "@markora/contracts";
import { DEFAULT_AUTOSAVE_DEBOUNCE_MS, extractMarkdownOutline } from "@markora/markdown";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createEmergencyDraft,
  deleteEmergencyDraftIfMatching,
  discardEmergencyDraft,
  type EmergencyDraft,
  readEmergencyDraft,
  writeEmergencyDraft,
} from "./draft-storage.js";
import { type EditorMode, MarkdownPreview, SourceEditor, WysiwygEditor } from "./MarkdownEditor.js";
import { readPreferenceSettings } from "./preferences.js";
import { buildVersionDiffRows } from "./version-diff.js";
import {
  downloadDocumentSource,
  getDocumentVersion,
  getDocumentVersions,
  restoreDocumentVersion,
  saveDocumentContent,
  WorkspaceApiError,
} from "./workspace-api.js";

type SaveStatus = "saved" | "local" | "saving" | "offline" | "failed" | "conflict";

interface RevisionConflict {
  readonly localMarkdown: string;
  readonly localUpdatedAt: string;
  readonly serverMarkdown: string;
  readonly serverRevision: number;
  readonly serverSavedAt: string;
}

export function DocumentWorkspace({
  document,
  onMetadataAction,
  onUnsyncedChange,
}: {
  readonly document: DocumentDetail;
  readonly onMetadataAction: (kind: "rename" | "move" | "trash") => void;
  readonly onUnsyncedChange: (documentId: string | null) => void;
}) {
  const [markdown, setMarkdown] = useState(document.markdown);
  const [baseRevision, setBaseRevision] = useState(document.revision);
  const [acknowledgedMarkdown, setAcknowledgedMarkdown] = useState(document.markdown);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [mode, setMode] = useState<EditorMode>(() => readMode(document));
  const [recoveryDraft, setRecoveryDraft] = useState<EmergencyDraft | null>(null);
  const [reviewRecovery, setReviewRecovery] = useState(false);
  const [conflict, setConflict] = useState<RevisionConflict | null>(null);
  const [reviewConflict, setReviewConflict] = useState(false);
  const [editorFailure, setEditorFailure] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [desktopSplit, setDesktopSplit] = useState(
    () => window.matchMedia("(min-width: 1280px)").matches,
  );
  const [savingSnapshot, setSavingSnapshot] = useState<string | null>(null);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const preferences = readPreferenceSettings();
  const queryClient = useQueryClient();
  const markdownRef = useRef(markdown);
  const revisionRef = useRef(baseRevision);
  const acknowledgedRef = useRef(acknowledgedMarkdown);
  markdownRef.current = markdown;
  revisionRef.current = baseRevision;
  acknowledgedRef.current = acknowledgedMarkdown;

  const dirty = markdown !== acknowledgedMarkdown;
  const splitAvailable = document.capabilities.split && desktopSplit;
  const outline = useMemo(() => extractMarkdownOutline(markdown), [markdown]);
  const versionsQuery = useQuery({
    queryKey: ["document", document.id, "versions"],
    queryFn: () => getDocumentVersions(document.id),
    enabled: historyOpen,
  });
  const versionQuery = useQuery({
    queryKey: ["document", document.id, "versions", selectedVersionId],
    queryFn: () => getDocumentVersion(document.id, selectedVersionId ?? ""),
    enabled: historyOpen && selectedVersionId !== null,
  });
  const restoreVersionMutation = useMutation({
    mutationFn: () => restoreDocumentVersion(document.id, selectedVersionId ?? "", baseRevision),
    onSuccess: async (result) => {
      if (!versionQuery.data) return;
      const restoredMarkdown = versionQuery.data.markdown;
      setMarkdown(restoredMarkdown);
      setAcknowledgedMarkdown(restoredMarkdown);
      setBaseRevision(result.revision);
      setStatus("saved");
      setHistoryOpen(false);
      setSelectedVersionId(null);
      setEditorGeneration((value) => value + 1);
      await discardEmergencyDraft(document.id);
      queryClient.setQueryData<DocumentDetail>(["document", document.id], (current) =>
        current
          ? {
              ...current,
              name: versionQuery.data?.documentName ?? current.name,
              markdown: restoredMarkdown,
              revision: result.revision,
            }
          : current,
      );
      await queryClient.invalidateQueries({ queryKey: ["document", document.id, "versions"] });
    },
  });

  useEffect(() => {
    let disposed = false;
    void readEmergencyDraft(document.id).then((draft) => {
      if (!disposed && draft && draft.markdown !== document.markdown) setRecoveryDraft(draft);
    });
    return () => {
      disposed = true;
    };
  }, [document.id, document.markdown]);

  useEffect(() => {
    const connect = () => setOnline(true);
    const disconnect = () => setOnline(false);
    window.addEventListener("online", connect);
    window.addEventListener("offline", disconnect);
    return () => {
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", disconnect);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const update = () => {
      setDesktopSplit(media.matches);
      if (!media.matches) setMode((current) => (current === "split" ? "source" : current));
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (dirty) onUnsyncedChange(document.id);
    else onUnsyncedChange(null);
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    const warnInternalNavigation = (event: MouseEvent) => {
      if (!dirty || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank") return;
      if (!window.confirm("This document has unsynced edits. Leave and keep the local draft?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    window.document.addEventListener("click", warnInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.document.removeEventListener("click", warnInternalNavigation, true);
      onUnsyncedChange(null);
    };
  }, [dirty, document.id, onUnsyncedChange]);

  const saveSnapshot = useCallback(
    async (snapshot: string, overwriteRevision?: number) => {
      setStatus("saving");
      setSavingSnapshot(snapshot);
      try {
        const result = await saveDocumentContent(document.id, {
          markdown: snapshot,
          baseRevision: overwriteRevision ?? revisionRef.current,
          clientMutationId: crypto.randomUUID(),
          ...(overwriteRevision === undefined
            ? {}
            : { conflictResolution: "OVERWRITE_SERVER" as const }),
        });
        setBaseRevision(result.revision);
        revisionRef.current = result.revision;
        setAcknowledgedMarkdown(snapshot);
        acknowledgedRef.current = snapshot;
        await deleteEmergencyDraftIfMatching(document.id, snapshot);
        if (markdownRef.current === snapshot) {
          setStatus("saved");
        } else {
          await writeEmergencyDraft(
            createEmergencyDraft(document.id, result.revision, markdownRef.current),
          );
          setStatus(online ? "local" : "offline");
        }
        setConflict(null);
        setReviewConflict(false);
      } catch (error) {
        if (error instanceof WorkspaceApiError && error.code === "REVISION_CONFLICT") {
          setConflict({
            localMarkdown: snapshot,
            localUpdatedAt: new Date().toISOString(),
            serverMarkdown:
              typeof error.details?.serverMarkdown === "string" ? error.details.serverMarkdown : "",
            serverRevision:
              typeof error.details?.serverRevision === "number"
                ? error.details.serverRevision
                : revisionRef.current,
            serverSavedAt:
              typeof error.details?.serverSavedAt === "string"
                ? error.details.serverSavedAt
                : new Date().toISOString(),
          });
          setStatus("conflict");
        } else {
          setStatus(navigator.onLine ? "failed" : "offline");
        }
      } finally {
        setSavingSnapshot(null);
      }
    },
    [document.id, online],
  );

  useEffect(() => {
    if (preferences.autoSave === false || !dirty || conflict || savingSnapshot !== null) return;
    if (!online) {
      setStatus("offline");
      return;
    }
    const timer = window.setTimeout(() => {
      void saveSnapshot(markdownRef.current);
    }, DEFAULT_AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [conflict, dirty, online, preferences.autoSave, saveSnapshot, savingSnapshot]);

  function edit(next: string) {
    setMarkdown(next);
    markdownRef.current = next;
    setStatus(navigator.onLine ? "local" : "offline");
    void writeEmergencyDraft(createEmergencyDraft(document.id, revisionRef.current, next)).catch(
      () => setStatus("failed"),
    );
  }

  function changeMode(next: EditorMode) {
    if (
      (document.capabilities.largeDocument && next !== "source") ||
      (next === "split" && !splitAvailable)
    )
      return;
    setEditorFailure(null);
    setMode(next);
    localStorage.setItem("markora.editor.mode", next);
  }

  function openSourceWithError(message: string) {
    changeMode("source");
    setEditorFailure(message);
  }

  return (
    <>
      <header className="document-header">
        <div>
          <p className="document-path">
            {document.breadcrumbs.map((item) => item.name).join(" / ") || "Workspace root"}
          </p>
          <h1>{document.name}</h1>
          <SaveIndicator status={status} revision={baseRevision} />
        </div>
        <div className="document-actions">
          <button
            type="button"
            onClick={() => {
              setEditorFailure(null);
              void downloadDocumentSource(document.id).catch((error) =>
                setEditorFailure(error instanceof Error ? error.message : "Download failed."),
              );
            }}
          >
            Download .md
          </button>
          <button type="button" onClick={() => setHistoryOpen(true)}>
            History
          </button>
          <button type="button" onClick={() => onMetadataAction("rename")}>
            Rename
          </button>
          <button type="button" onClick={() => onMetadataAction("move")}>
            Move
          </button>
          <button type="button" onClick={() => onMetadataAction("trash")}>
            Trash
          </button>
        </div>
      </header>

      <div className="editor-toolbar" role="toolbar" aria-label="Document mode">
        <button
          type="button"
          className={mode === "wysiwyg" ? "active" : undefined}
          aria-pressed={mode === "wysiwyg"}
          disabled={!document.capabilities.wysiwyg}
          onClick={() => changeMode("wysiwyg")}
        >
          WYSIWYG
        </button>
        <button
          type="button"
          className={mode === "source" ? "active" : undefined}
          aria-pressed={mode === "source"}
          onClick={() => changeMode("source")}
        >
          Source
        </button>
        <button
          type="button"
          className={mode === "split" ? "active" : undefined}
          aria-pressed={mode === "split"}
          disabled={!splitAvailable}
          onClick={() => changeMode("split")}
        >
          Split
        </button>
        {dirty && online && !conflict ? (
          <button
            type="button"
            disabled={status === "saving"}
            onClick={() => void saveSnapshot(markdown)}
          >
            Save now
          </button>
        ) : null}
      </div>

      {document.capabilities.largeDocument ? (
        <div className="editor-safety-notice" role="status">
          Large document mode is active. Visual and live split rendering are disabled to keep
          editing responsive.
        </div>
      ) : null}
      {!online ? (
        <div className="editor-safety-notice" role="status">
          Offline: this already-open document remains editable and is protected in a local draft.
          Other workspace data is not available offline.
        </div>
      ) : null}
      {editorFailure ? (
        <div className="operation-notice" role="alert">
          {editorFailure}
          <button type="button" onClick={() => setEditorFailure(null)}>
            ×
          </button>
        </div>
      ) : null}
      {status === "failed" ? (
        <div className="operation-notice" role="alert">
          Server save failed. Your local draft is safe.
          <button type="button" onClick={() => void saveSnapshot(markdown)}>
            Retry save
          </button>
        </div>
      ) : null}

      <div className={`editor-stage editor-mode-${mode}`}>
        <div className="editor-paper">
          {mode === "source" ? (
            <SourceEditor
              key={`${document.id}:source:${editorGeneration}`}
              initialMarkdown={markdown}
              onChange={edit}
              wrap={preferences.wrap ?? true}
              tabSize={preferences.tabSize ?? 2}
              lineNumbers={preferences.sourceLineNumbers ?? true}
            />
          ) : null}
          {mode === "wysiwyg" ? (
            <WysiwygEditor
              key={`${document.id}:wysiwyg:${editorGeneration}`}
              initialMarkdown={markdown}
              onChange={edit}
              onFailure={openSourceWithError}
            />
          ) : null}
          {mode === "split" ? (
            <div className="split-editor">
              <SourceEditor
                key={`${document.id}:split:${editorGeneration}`}
                initialMarkdown={markdown}
                onChange={edit}
                wrap={preferences.wrap ?? true}
                tabSize={preferences.tabSize ?? 2}
                lineNumbers={preferences.sourceLineNumbers ?? true}
              />
              <MarkdownPreview
                markdown={markdown}
                onEditSource={() => changeMode("source")}
                renderMermaid={preferences.mermaid ?? true}
                renderMath={preferences.math ?? true}
                externalImages={preferences.externalImages ?? false}
                linkTarget={preferences.linkTarget ?? "NEW_TAB"}
              />
            </div>
          ) : null}
        </div>
        {preferences.outline !== false && outline.length > 0 ? (
          <aside className="document-outline" aria-label="Document outline">
            <strong>Outline</strong>
            <ol>
              {outline.map((item) => (
                <li
                  key={`${item.line}:${item.text}`}
                  style={{ paddingLeft: `${(item.level - 1) * 10}px` }}
                >
                  <button type="button" onClick={() => scrollToHeading(item.text)}>
                    {item.text}
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        ) : null}
      </div>

      {recoveryDraft ? (
        <RecoveryDialog
          draft={recoveryDraft}
          document={document}
          reviewing={reviewRecovery}
          onReview={() => setReviewRecovery((value) => !value)}
          onRestore={() => {
            edit(recoveryDraft.markdown);
            setBaseRevision(document.revision);
            setRecoveryDraft(null);
            setReviewRecovery(false);
            setEditorGeneration((value) => value + 1);
            changeMode("source");
          }}
          onDiscard={() => {
            void discardEmergencyDraft(document.id);
            setRecoveryDraft(null);
            setReviewRecovery(false);
          }}
        />
      ) : null}
      {conflict ? (
        <ConflictDialog
          conflict={conflict}
          reviewing={reviewConflict}
          onReview={() => setReviewConflict((value) => !value)}
          onKeepServer={() => {
            setMarkdown(conflict.serverMarkdown);
            setAcknowledgedMarkdown(conflict.serverMarkdown);
            setBaseRevision(conflict.serverRevision);
            void discardEmergencyDraft(document.id);
            setConflict(null);
            setStatus("saved");
            setEditorGeneration((value) => value + 1);
            changeMode("source");
          }}
          onOverwrite={() => void saveSnapshot(conflict.localMarkdown, conflict.serverRevision)}
          onDownload={() =>
            downloadMarkdown(conflict.localMarkdown, `${document.name}.local-draft.md`)
          }
        />
      ) : null}
      {historyOpen ? (
        <VersionHistoryPanel
          currentMarkdown={markdown}
          dirty={dirty}
          versions={versionsQuery.data?.data ?? []}
          selected={versionQuery.data ?? null}
          selectedVersionId={selectedVersionId}
          loading={versionsQuery.isPending || versionQuery.isFetching}
          error={versionsQuery.error ?? versionQuery.error ?? restoreVersionMutation.error}
          restoring={restoreVersionMutation.isPending}
          onSelect={setSelectedVersionId}
          onRestore={() => restoreVersionMutation.mutate()}
          onClose={() => {
            setHistoryOpen(false);
            setSelectedVersionId(null);
          }}
        />
      ) : null}
    </>
  );
}

function VersionHistoryPanel({
  currentMarkdown,
  dirty,
  versions,
  selected,
  selectedVersionId,
  loading,
  error,
  restoring,
  onSelect,
  onRestore,
  onClose,
}: {
  readonly currentMarkdown: string;
  readonly dirty: boolean;
  readonly versions: readonly {
    id: string;
    versionNo: number;
    reason: string;
    sourceRevision: number;
    actor: { displayName: string };
    createdAt: string;
  }[];
  readonly selected: { id: string; markdown: string; documentName: string } | null;
  readonly selectedVersionId: string | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly restoring: boolean;
  readonly onSelect: (id: string) => void;
  readonly onRestore: () => void;
  readonly onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop">
      <section
        className="version-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-title"
      >
        <header>
          <div>
            <p className="eyebrow">IMMUTABLE HISTORY</p>
            <h2 id="version-title">Version history</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close version history"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {error ? (
          <div className="operation-notice" role="alert">
            {error.message} The current document and local draft were not changed. Retry or close.
          </div>
        ) : null}
        {dirty ? (
          <div className="editor-safety-notice" role="status">
            Restore is blocked while this document has unsynced edits. Save or recover the local
            draft first.
          </div>
        ) : null}
        <div className="version-layout">
          <aside aria-label="Versions">
            {loading && versions.length === 0 ? <p role="status">Loading versions…</p> : null}
            {versions.length === 0 && !loading ? <p>No safety snapshots yet.</p> : null}
            <ul className="version-list">
              {versions.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    className={selectedVersionId === version.id ? "selected" : undefined}
                    onClick={() => onSelect(version.id)}
                  >
                    <strong>Revision {version.sourceRevision}</strong>
                    <small>
                      {formatVersionReason(version.reason)} · {formatVersionDate(version.createdAt)}
                    </small>
                    <small>{version.actor.displayName}</small>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div className="version-preview">
            {selected ? (
              <>
                <div className="version-preview-heading">
                  <div>
                    <strong>{selected.documentName}</strong>
                    <small>Preview only; current content is unchanged.</small>
                  </div>
                  <button
                    className="primary-action"
                    type="button"
                    disabled={dirty || restoring}
                    onClick={onRestore}
                  >
                    {restoring ? "Restoring…" : "Restore this version"}
                  </button>
                </div>
                <LineDiff before={selected.markdown} after={currentMarkdown} />
              </>
            ) : (
              <p>Select a version to preview its difference from the current document.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function LineDiff({ before, after }: { readonly before: string; readonly after: string }) {
  const rows = buildVersionDiffRows(before, after);
  return (
    <section className="line-diff" aria-label="Line comparison">
      <div>
        <strong>Selected version</strong>
      </div>
      <div>
        <strong>Current document</strong>
      </div>
      {rows.map((row) => {
        return (
          <div className="line-diff-row" key={row.key}>
            <pre className={row.changed ? "removed" : undefined}>{row.oldLine || " "}</pre>
            <pre className={row.changed ? "added" : undefined}>{row.currentLine || " "}</pre>
          </div>
        );
      })}
    </section>
  );
}

function formatVersionReason(reason: string): string {
  return reason.toLowerCase().replaceAll("_", " ");
}

function formatVersionDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function SaveIndicator({
  status,
  revision,
}: {
  readonly status: SaveStatus;
  readonly revision: number;
}) {
  const labels: Record<SaveStatus, string> = {
    saved: `Saved · Revision ${revision}`,
    local: "Local draft safe · Waiting to save",
    saving: "Saving… · Local draft safe",
    offline: "Offline · Local draft safe",
    failed: "Save failed · Local draft safe",
    conflict: "Conflict · Local draft safe",
  };
  return (
    <span className={`save-status save-${status}`} role="status">
      <i /> {labels[status]}
    </span>
  );
}

function RecoveryDialog({
  draft,
  document,
  reviewing,
  onReview,
  onRestore,
  onDiscard,
}: {
  readonly draft: EmergencyDraft;
  readonly document: DocumentDetail;
  readonly reviewing: boolean;
  readonly onReview: () => void;
  readonly onRestore: () => void;
  readonly onDiscard: () => void;
}) {
  return (
    <div className="dialog-backdrop">
      <section
        className="action-dialog recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-title"
      >
        <h2 id="draft-title">A local draft is available</h2>
        <p>
          The server remains at revision {document.revision}. This local draft was saved{" "}
          {formatTime(draft.updatedAt)} and has not changed the server.
        </p>
        {reviewing ? (
          <div className="conflict-review">
            <label>
              Local draft
              <textarea readOnly value={draft.markdown} />
            </label>
            <label>
              Server revision {document.revision}
              <textarea readOnly value={document.markdown} />
            </label>
          </div>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="secondary-action" onClick={onReview}>
            {reviewing ? "Hide review" : "Review"}
          </button>
          <button type="button" className="secondary-action" onClick={onDiscard}>
            Discard
          </button>
          <button type="button" className="primary-action" onClick={onRestore}>
            Restore Draft
          </button>
        </div>
      </section>
    </div>
  );
}

function ConflictDialog({
  conflict,
  reviewing,
  onReview,
  onKeepServer,
  onOverwrite,
  onDownload,
}: {
  readonly conflict: RevisionConflict;
  readonly reviewing: boolean;
  readonly onReview: () => void;
  readonly onKeepServer: () => void;
  readonly onOverwrite: () => void;
  readonly onDownload: () => void;
}) {
  return (
    <div className="dialog-backdrop">
      <section
        className="conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
      >
        <h2 id="conflict-title">Revision conflict</h2>
        <p>
          The server advanced to revision {conflict.serverRevision} at{" "}
          {formatTime(conflict.serverSavedAt)}. Auto-save has stopped and your local draft remains
          safe. Saving it as current first protects the server content in version history.
        </p>
        {reviewing ? (
          <div className="conflict-review">
            <label>
              Local draft · {formatTime(conflict.localUpdatedAt)}
              <textarea readOnly value={conflict.localMarkdown} />
            </label>
            <label>
              Server revision {conflict.serverRevision}
              <textarea readOnly value={conflict.serverMarkdown} />
            </label>
          </div>
        ) : null}
        <div className="dialog-actions conflict-actions">
          <button type="button" className="secondary-action" onClick={onReview}>
            {reviewing ? "Hide review" : "Review changes"}
          </button>
          <button type="button" className="secondary-action" onClick={onDownload}>
            Download local Markdown
          </button>
          <button type="button" className="secondary-action" onClick={onKeepServer}>
            Keep server version
          </button>
          <button type="button" className="primary-action" onClick={onOverwrite}>
            Save local as current
          </button>
        </div>
      </section>
    </div>
  );
}

function readMode(document: DocumentDetail): EditorMode {
  if (document.capabilities.largeDocument) return "source";
  const stored = localStorage.getItem("markora.editor.mode");
  if (stored === "split" && !window.matchMedia("(min-width: 1280px)").matches) return "source";
  if (stored === "source" || stored === "split" || stored === "wysiwyg") return stored;
  const preferred = readPreferenceSettings().defaultEditorMode;
  if (preferred === "split" && !window.matchMedia("(min-width: 1280px)").matches) return "source";
  return preferred === "source" || preferred === "split" || preferred === "wysiwyg"
    ? preferred
    : "wysiwyg";
}

function scrollToHeading(text: string) {
  const headings = document.querySelectorAll<HTMLElement>(
    ".editor-stage h1, .editor-stage h2, .editor-stage h3, .editor-stage h4, .editor-stage h5, .editor-stage h6",
  );
  [...headings]
    .find((heading) => heading.textContent?.trim() === text)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function downloadMarkdown(markdown: string, name: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
