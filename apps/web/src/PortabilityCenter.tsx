import type {
  BackgroundJob,
  ExportRequest,
  ImportConflictStrategy,
  ImportPreviewResult,
} from "@markora/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  cancelJob,
  createExport,
  downloadExport,
  executeImport,
  getJob,
  getJobItems,
  previewImport,
  retryFailedJob,
  uploadImport,
} from "./workspace-api.js";

export type PortabilityCommand =
  | { kind: "import"; files?: File[]; targetFolderId?: string | null }
  | { kind: "export"; request: ExportRequest };

interface ActiveJob {
  id: string;
  type: "IMPORT" | "EXPORT";
  targetFolderId: string | null;
  downloadToken?: string;
}

export function dispatchPortability(command: PortabilityCommand): void {
  window.dispatchEvent(new CustomEvent("markora:portability-command", { detail: command }));
}

export function PortabilityCenter({ onImported }: { readonly onImported: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [strategy, setStrategy] = useState<ImportConflictStrategy>("KEEP_BOTH");
  const [overrides, setOverrides] = useState<Map<string, ImportConflictStrategy>>(new Map());
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: async () => {
      const upload = await uploadImport(files);
      return previewImport(upload.uploadToken, targetFolderId);
    },
    onSuccess: (result) => {
      setPreview(result);
      setOverrides(new Map());
    },
  });
  const executeMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("Preview the import first.");
      return executeImport(preview.planId, {
        idempotencyKey: crypto.randomUUID(),
        conflictStrategy: strategy,
        overrides: [...overrides].map(([sourceKey, itemStrategy]) => ({
          sourceKey,
          strategy: itemStrategy,
        })),
      });
    },
    onSuccess: ({ job }) => {
      setActiveJob({ id: job.id, type: "IMPORT", targetFolderId: preview?.targetFolderId ?? null });
      setImportOpen(false);
      setPreview(null);
      setFiles([]);
      setNotice("Import is running in the background. You can keep editing.");
    },
  });
  const exportMutation = useMutation({
    mutationFn: createExport,
    onSuccess: (result) => {
      setActiveJob({
        id: result.job.id,
        type: "EXPORT",
        targetFolderId: null,
        downloadToken: result.downloadToken,
      });
      setNotice("Export snapshot captured. The archive is being prepared.");
    },
  });
  const exportMutationRef = useRef(exportMutation.mutate);
  exportMutationRef.current = exportMutation.mutate;

  useEffect(() => {
    const listener = (event: Event) => {
      const command = (event as CustomEvent<PortabilityCommand>).detail;
      setNotice(null);
      if (command.kind === "import") {
        setFiles(command.files ?? []);
        setTargetFolderId(command.targetFolderId ?? null);
        setPreview(null);
        setImportOpen(true);
      } else {
        exportMutationRef.current(command.request);
      }
    };
    window.addEventListener("markora:portability-command", listener);
    return () => window.removeEventListener("markora:portability-command", listener);
  }, []);

  const jobQuery = useQuery({
    queryKey: ["portability-job", activeJob?.id],
    queryFn: () => getJob(activeJob?.id ?? ""),
    enabled: Boolean(activeJob),
    refetchInterval: (query) =>
      query.state.data && terminal(query.state.data.state) ? false : 1_000,
  });
  const itemsQuery = useQuery({
    queryKey: ["portability-job-items", activeJob?.id],
    queryFn: () => getJobItems(activeJob?.id ?? ""),
    enabled: Boolean(activeJob && jobQuery.data && terminal(jobQuery.data.state)),
  });

  useEffect(() => {
    if (activeJob?.type === "IMPORT" && jobQuery.data && terminal(jobQuery.data.state)) {
      void onImported();
    }
  }, [activeJob?.type, jobQuery.data, onImported]);

  const cancelMutation = useMutation({
    mutationFn: cancelJob,
    onSuccess: ({ job }) => queryClient.setQueryData(["portability-job", job.id], job),
  });
  const retryMutation = useMutation({
    mutationFn: retryFailedJob,
    onSuccess: ({ job }) => {
      setActiveJob({
        id: job.id,
        type: "IMPORT",
        targetFolderId: activeJob?.targetFolderId ?? null,
      });
      setNotice("Retrying failed items only.");
    },
  });

  const error =
    previewMutation.error ??
    executeMutation.error ??
    exportMutation.error ??
    cancelMutation.error ??
    retryMutation.error;
  return (
    <>
      {importOpen ? (
        <ImportDialog
          files={files}
          preview={preview}
          strategy={strategy}
          overrides={overrides}
          busy={previewMutation.isPending || executeMutation.isPending}
          error={error?.message ?? null}
          onFiles={(next) => {
            setFiles(next);
            setPreview(null);
          }}
          onPreview={() => previewMutation.mutate()}
          onStrategy={setStrategy}
          onOverride={(sourceKey, itemStrategy) =>
            setOverrides((current) => new Map(current).set(sourceKey, itemStrategy))
          }
          onApplyAll={() =>
            setOverrides(
              new Map(
                (preview?.items ?? [])
                  .filter((item) => item.status === "CONFLICT")
                  .map((item) => [item.sourceKey, strategy]),
              ),
            )
          }
          onExecute={() => executeMutation.mutate()}
          onClose={() => setImportOpen(false)}
        />
      ) : null}
      {activeJob ? (
        <JobTray
          active={activeJob}
          job={jobQuery.data ?? null}
          failures={itemsQuery.data?.data.filter((item) => item.state === "FAILED") ?? []}
          notice={notice}
          error={error?.message ?? (jobQuery.error?.message || null)}
          busy={cancelMutation.isPending || retryMutation.isPending}
          onCancel={() => cancelMutation.mutate(activeJob.id)}
          onRetry={() => retryMutation.mutate(activeJob.id)}
          onDownload={() => {
            if (activeJob.downloadToken) {
              void downloadExport(activeJob.id, activeJob.downloadToken).catch((downloadError) =>
                setNotice(
                  downloadError instanceof Error ? downloadError.message : "Download failed.",
                ),
              );
            }
          }}
          onClose={() => setActiveJob(null)}
        />
      ) : exportMutation.isPending ? (
        <div className="job-tray" role="status">
          Capturing export snapshot…
        </div>
      ) : null}
    </>
  );
}

function ImportDialog({
  files,
  preview,
  strategy,
  overrides,
  busy,
  error,
  onFiles,
  onPreview,
  onStrategy,
  onOverride,
  onApplyAll,
  onExecute,
  onClose,
}: {
  readonly files: readonly File[];
  readonly preview: ImportPreviewResult | null;
  readonly strategy: ImportConflictStrategy;
  readonly overrides: ReadonlyMap<string, ImportConflictStrategy>;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onFiles: (files: File[]) => void;
  readonly onPreview: () => void;
  readonly onStrategy: (strategy: ImportConflictStrategy) => void;
  readonly onOverride: (sourceKey: string, strategy: ImportConflictStrategy) => void;
  readonly onApplyAll: () => void;
  readonly onExecute: () => void;
  readonly onClose: () => void;
}) {
  const folderInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
    folderInput.current?.setAttribute("directory", "");
  }, []);
  return (
    <div className="dialog-backdrop">
      <section
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <header>
          <div>
            <p className="eyebrow">PORTABLE MARKDOWN</p>
            <h2 id="import-title">Import documents</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close import" onClick={onClose}>
            ×
          </button>
        </header>
        {!preview ? (
          <div className="import-picker">
            <p>
              Choose Markdown files, one ZIP archive, or a folder. A safe preview is required before
              any workspace writes.
            </p>
            <div className="dialog-actions">
              <label className="secondary-action file-action">
                Files or ZIP
                <input
                  type="file"
                  multiple
                  accept=".md,.zip,text/markdown,application/zip"
                  onChange={(event) => onFiles([...(event.currentTarget.files ?? [])])}
                />
              </label>
              <label className="secondary-action file-action">
                Folder
                <input
                  ref={folderInput}
                  type="file"
                  multiple
                  onChange={(event) => onFiles([...(event.currentTarget.files ?? [])])}
                />
              </label>
            </div>
            <p className="field-hint">
              {files.length > 0 ? `${files.length} item(s) selected.` : "Nothing selected yet."}
            </p>
            <button
              className="primary-action"
              type="button"
              disabled={files.length === 0 || busy}
              onClick={onPreview}
            >
              {busy ? "Checking safely…" : "Preview import"}
            </button>
          </div>
        ) : (
          <div className="import-preview">
            <div className="import-summary">
              <strong>{preview.summary.documents} documents</strong>
              <span>{preview.summary.folders} folders</span>
              <span>{preview.summary.conflicts} conflicts</span>
              <span>{preview.summary.ignoredNonMarkdown} ignored</span>
            </div>
            {preview.warnings.map((warning) => (
              <p key={warning.code} className="operation-notice">
                {warning.message} ({warning.count})
              </p>
            ))}
            <div className="conflict-controls">
              <label>
                Default conflict action
                <select
                  value={strategy}
                  onChange={(event) => onStrategy(event.target.value as ImportConflictStrategy)}
                >
                  <option value="KEEP_BOTH">Keep Both</option>
                  <option value="SKIP">Skip</option>
                  <option value="REPLACE">Replace with protected version</option>
                </select>
              </label>
              <button type="button" className="secondary-action" onClick={onApplyAll}>
                Apply to all conflicts
              </button>
            </div>
            <ul className="import-tree">
              {preview.items.map((item) => (
                <li key={item.sourceKey}>
                  <span>
                    <strong>{item.targetPath}</strong>
                    <small>
                      {item.status} · {item.bytes} bytes
                    </small>
                  </span>
                  {item.status === "CONFLICT" ? (
                    <select
                      aria-label={`Conflict action for ${item.targetPath}`}
                      value={overrides.get(item.sourceKey) ?? strategy}
                      onChange={(event) =>
                        onOverride(item.sourceKey, event.target.value as ImportConflictStrategy)
                      }
                    >
                      <option value="KEEP_BOTH">Keep Both</option>
                      <option value="SKIP">Skip</option>
                      <option value="REPLACE">Replace</option>
                    </select>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button className="secondary-action" type="button" onClick={() => onFiles([])}>
                Choose again
              </button>
              <button className="primary-action" type="button" disabled={busy} onClick={onExecute}>
                {busy ? "Starting…" : "Start import"}
              </button>
            </div>
          </div>
        )}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function JobTray({
  active,
  job,
  failures,
  notice,
  error,
  busy,
  onCancel,
  onRetry,
  onDownload,
  onClose,
}: {
  readonly active: ActiveJob;
  readonly job: BackgroundJob | null;
  readonly failures: readonly {
    id: string;
    sourceKey: string;
    errorCode: string | null;
    result: Record<string, unknown> | null;
  }[];
  readonly notice: string | null;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly onDownload: () => void;
  readonly onClose: () => void;
}) {
  const running = job?.state === "PENDING" || job?.state === "RUNNING";
  const statusNotice = running
    ? notice
    : job?.state === "SUCCEEDED"
      ? active.type === "IMPORT"
        ? "Import complete. The workspace has been refreshed."
        : "Export ready to download."
      : notice;
  return (
    <aside className="job-tray" aria-live="polite">
      <div>
        <strong>
          {active.type === "IMPORT" ? "Import" : "Export"} · {job?.state ?? "QUEUED"}
        </strong>
        <small>
          {job
            ? `${job.progressDetail.completed}/${job.progressDetail.total} · ${job.progress}%`
            : "Waiting for status…"}
        </small>
        {statusNotice ? <span>{statusNotice}</span> : null}
        {error ? <span className="form-error">{error}</span> : null}
      </div>
      <progress max="100" value={job?.progress ?? 0}>
        {job?.progress ?? 0}%
      </progress>
      {failures.length > 0 ? (
        <details>
          <summary>{failures.length} failed item(s)</summary>
          <ul>
            {failures.map((item) => (
              <li key={item.id}>
                {String(item.result?.reason ?? item.errorCode ?? item.sourceKey)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="dialog-actions">
        {running ? (
          <button type="button" className="secondary-action" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        {active.type === "IMPORT" &&
        (job?.state === "FAILED" || job?.state === "SUCCEEDED_WITH_ISSUES") ? (
          <button type="button" className="secondary-action" disabled={busy} onClick={onRetry}>
            Retry failed
          </button>
        ) : null}
        {active.type === "EXPORT" && job?.state === "SUCCEEDED" ? (
          <button type="button" className="primary-action" onClick={onDownload}>
            Download ZIP
          </button>
        ) : null}
        {!running ? (
          <button type="button" className="secondary-action" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function terminal(state: BackgroundJob["state"]): boolean {
  return ["SUCCEEDED", "SUCCEEDED_WITH_ISSUES", "FAILED", "CANCELLED", "INTERRUPTED"].includes(
    state,
  );
}
