import type { BackgroundJob, Principal, TrashItem } from "@markora/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { flattenFolders, GlobalRail } from "./WorkspacePage.js";
import {
  getFolderTree,
  getJob,
  getTrash,
  permanentlyDeleteTrashItem,
  restoreTrashItem,
} from "./workspace-api.js";

export function TrashPage({
  principal,
  onLogout,
}: {
  readonly principal: Principal;
  readonly onLogout: () => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const trashQuery = useQuery({ queryKey: ["trash"], queryFn: getTrash });
  const treeQuery = useQuery({ queryKey: ["folders", "tree"], queryFn: getFolderTree });
  const folders = useMemo(() => flattenFolders(treeQuery.data?.data ?? []), [treeQuery.data]);
  const [targets, setTargets] = useState<Record<string, string | undefined>>(Object.create(null));
  const [keepBoth, setKeepBoth] = useState<Record<string, boolean>>(Object.create(null));
  const [jobs, setJobs] = useState<Record<string, BackgroundJob>>(Object.create(null));
  const [notice, setNotice] = useState<string | null>(null);

  const restoreMutation = useMutation({
    mutationFn: (item: TrashItem) =>
      restoreTrashItem(
        item.type,
        item.id,
        targets[item.id] === undefined ? undefined : targets[item.id] || null,
        keepBoth[item.id] ? "KEEP_BOTH" : "FAIL",
      ),
    onSuccess: async () => {
      setNotice("Item restored. Active navigation is current.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["trash"] }),
        queryClient.invalidateQueries({ queryKey: ["folders"] }),
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
      ]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (item: Pick<TrashItem, "type" | "id">) =>
      permanentlyDeleteTrashItem(item.type, item.id),
    onSuccess: (result) => {
      setJobs((current) => ({ ...current, [result.job.id]: result.job }));
      setNotice("Permanent deletion queued. The item is unavailable while deletion runs.");
      void queryClient.invalidateQueries({ queryKey: ["trash"] });
    },
  });

  useEffect(() => {
    const pending = Object.values(jobs).filter(
      (job) => job.state === "PENDING" || job.state === "RUNNING",
    );
    if (pending.length === 0) return;
    const timer = window.setInterval(() => {
      void Promise.all(pending.map((job) => getJob(job.id))).then((updated) => {
        setJobs((current) => ({
          ...current,
          ...Object.fromEntries(updated.map((job) => [job.id, job])),
        }));
        if (updated.some((job) => job.state === "SUCCEEDED")) {
          void queryClient.invalidateQueries({ queryKey: ["trash"] });
        }
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [jobs, queryClient]);

  const error = restoreMutation.error ?? deleteMutation.error ?? trashQuery.error;
  return (
    <div className="app-shell trash-layout">
      <GlobalRail principal={principal} onLogout={onLogout} current="trash" />
      <main className="settings-surface panel">
        <header className="settings-header">
          <p className="eyebrow">RECOVERY</p>
          <h1>Trash</h1>
          <p>
            Restore a logical root or permanently delete it. Permanent deletion removes app access;
            encrypted backups may retain data until their retention period expires.
          </p>
        </header>
        {notice ? (
          <div className="operation-notice" role="status">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="operation-notice" role="alert">
            <span>
              {error.message} Your trashed data is unchanged. Choose another target, enable Keep
              Both, or retry.
            </span>
          </div>
        ) : null}
        <section className="settings-card trash-card" aria-labelledby="trash-items-heading">
          <h2 id="trash-items-heading">Deleted items</h2>
          {trashQuery.isPending ? <p role="status">Loading Trash…</p> : null}
          {trashQuery.data?.data.length === 0 ? <p>Trash is empty.</p> : null}
          <ul className="trash-list">
            {trashQuery.data?.data.map((item) => {
              const job = Object.values(jobs).find((candidate) => candidate.targetId === item.id);
              return (
                <li key={`${item.type}:${item.id}`}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.type === "FOLDER" ? "Folder" : "Document"} · {item.originalPath} ·
                      deleted {formatDate(item.deletedAt)}
                    </small>
                    <small>
                      {job
                        ? `Deletion ${job.state.toLowerCase()} · ${job.progress}%`
                        : `Routine retention until ${formatDate(item.permanentlyDeletableAt)}`}
                    </small>
                  </div>
                  <div className="trash-controls">
                    <label>
                      Restore target
                      <select
                        aria-label={`Restore target for ${item.name}`}
                        value={targets[item.id] ?? "original"}
                        disabled={item.state === "DELETING"}
                        onChange={(event) =>
                          setTargets((current) => ({
                            ...current,
                            [item.id]:
                              event.target.value === "original" ? undefined : event.target.value,
                          }))
                        }
                      >
                        <option value="original">Original location</option>
                        <option value="">Workspace root</option>
                        {folders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {"—".repeat(folder.depth)} {folder.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="keep-both-option">
                      <input
                        type="checkbox"
                        checked={keepBoth[item.id] ?? false}
                        disabled={item.state === "DELETING"}
                        onChange={(event) =>
                          setKeepBoth((current) => ({
                            ...current,
                            [item.id]: event.target.checked,
                          }))
                        }
                      />
                      Keep Both on name conflict
                    </label>
                    <div className="dialog-actions">
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={item.state === "DELETING" || restoreMutation.isPending}
                        onClick={() => restoreMutation.mutate(item)}
                      >
                        Restore
                      </button>
                      <button
                        className="danger-action"
                        type="button"
                        disabled={item.state === "DELETING" || deleteMutation.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Permanently delete ${item.name}? It will be unrecoverable in Markora. Backups may retain it until expiry.`,
                            )
                          ) {
                            deleteMutation.mutate({ type: item.type, id: item.id });
                          }
                        }}
                      >
                        Delete permanently
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
