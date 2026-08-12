import type { AdminConfigValues, Principal } from "@markora/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  cancelAdminJob,
  createAdminUser,
  getAdminAudit,
  getAdminConfig,
  getAdminHealth,
  getAdminJobs,
  getAdminOverview,
  getAdminSecurity,
  getAdminUser,
  getAdminUsers,
  resetAdminPassword,
  retryAdminJob,
  revokeAdminSessions,
  updateAdminConfig,
  updateAdminUser,
} from "./settings-api.js";
import { GlobalRail } from "./WorkspacePage.js";

const sections = ["overview", "users", "config", "security", "jobs", "audit", "system"] as const;

export function AdminPage({
  principal,
  onLogout,
}: {
  readonly principal: Principal;
  readonly onLogout: () => void | Promise<void>;
}) {
  const section = useParams().section ?? "overview";
  if (principal.role !== "ADMIN") return <Navigate to="/" replace />;
  return (
    <div className="app-shell settings-layout">
      <GlobalRail principal={principal} onLogout={onLogout} current="admin" />
      <aside className="settings-nav panel" aria-label="Admin sections">
        <p className="eyebrow">ADMINISTRATION</p>
        <h2>Operate</h2>
        {sections.map((item) => (
          <Link
            key={item}
            className={section === item ? "active" : undefined}
            to={`/admin/${item}`}
          >
            {title(item)}
          </Link>
        ))}
      </aside>
      <main className="settings-surface panel admin-surface">
        <header className="settings-header">
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>{title(section)}</h1>
          <p>
            Operational metadata only. Other users' document names, paths and content are never
            exposed.
          </p>
        </header>
        <AdminSection section={section} />
      </main>
    </div>
  );
}

function AdminSection({ section }: { readonly section: string }) {
  if (section === "overview") return <Overview />;
  if (section === "users") return <Users />;
  if (section === "config") return <Config />;
  if (section === "security") return <Security />;
  if (section === "jobs") return <Jobs />;
  if (section === "audit") return <Audit />;
  return <System />;
}

function Overview() {
  const query = useQuery({ queryKey: ["admin", "overview"], queryFn: getAdminOverview });
  if (!query.data) return <QueryState query={query} />;
  return (
    <>
      <section className="metric-grid">
        {Object.entries(query.data.counts).map(([key, value]) => (
          <article key={key} className="settings-card">
            <small>{title(key)}</small>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <section className="settings-card">
        <h2>Components</h2>
        {Object.entries(query.data.components).map(([key, value]) => (
          <p key={key}>
            <strong>{title(key)}</strong> · {value}
          </p>
        ))}
      </section>
      <section className="settings-card">
        <h2>Recent issues</h2>
        {query.data.recentIssues.length === 0 ? (
          <p>No failed or interrupted jobs.</p>
        ) : (
          <ul className="admin-list">
            {query.data.recentIssues.map((issue) => (
              <li key={issue.jobId}>
                <span>
                  <strong>
                    {issue.type} · {issue.state}
                  </strong>
                  <small>
                    {issue.errorCode ?? "No error code"} ·{" "}
                    {new Date(issue.occurredAt).toLocaleString()}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Users() {
  const client = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "ACTIVE" | "DISABLED">("");
  const [role, setRole] = useState<"" | "USER" | "ADMIN">("");
  const list = useQuery({
    queryKey: ["admin", "users", q, status, role],
    queryFn: () => getAdminUsers({ q, ...(status ? { status } : {}), ...(role ? { role } : {}) }),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({
    username: "",
    email: "",
    displayName: "",
    temporaryPassword: "",
    role: "USER" as "USER" | "ADMIN",
  });
  const detail = useQuery({
    queryKey: ["admin", "user", selected],
    queryFn: () => getAdminUser(selected ?? ""),
    enabled: Boolean(selected),
  });
  const action = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateAdminUser>[1] }) =>
      updateAdminUser(id, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["admin", "users"] });
      void client.invalidateQueries({ queryKey: ["admin", "user", selected] });
    },
  });
  const [password, setPassword] = useState("");
  const reset = useMutation({
    mutationFn: () => resetAdminPassword(selected ?? "", password),
    onSuccess: () => setPassword(""),
  });
  const revoke = useMutation({ mutationFn: () => revokeAdminSessions(selected ?? "") });
  const create = useMutation({
    mutationFn: createAdminUser,
    onSuccess: (user) => {
      setShowCreate(false);
      setNewUser({
        username: "",
        email: "",
        displayName: "",
        temporaryPassword: "",
        role: "USER",
      });
      setSelected(user.id);
      void client.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
  if (!list.data) return <QueryState query={list} />;
  return (
    <div className="admin-master-detail">
      <section className="settings-card">
        <div className="admin-section-heading">
          <h2>Users</h2>
          <button type="button" onClick={() => setShowCreate(true)}>
            New user
          </button>
        </div>
        <div className="admin-filters">
          <input
            aria-label="Search users"
            placeholder="Search users"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          <select
            aria-label="Filter user status"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
          </select>
          <select
            aria-label="Filter user role"
            value={role}
            onChange={(event) => setRole(event.target.value as typeof role)}
          >
            <option value="">All roles</option>
            <option value="USER">User</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        <ul className="admin-list">
          {list.data.data.map((user) => (
            <li key={user.id}>
              <button type="button" onClick={() => setSelected(user.id)}>
                <strong>{user.displayName}</strong>
                <small>
                  {user.username} · {user.role} · {user.status}
                </small>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {detail.data ? (
        <section className="settings-card">
          <h2>{detail.data.displayName}</h2>
          <p>{detail.data.email}</p>
          <p>
            {detail.data.counts.documents} documents · {detail.data.storageBytes} bytes ·{" "}
            {detail.data.counts.sessions} sessions
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              onClick={() => {
                const disabling = detail.data.status === "ACTIVE";
                if (
                  disabling &&
                  !window.confirm("Disable this user and revoke their active sessions?")
                )
                  return;
                action.mutate({
                  id: detail.data.id,
                  input: { status: disabling ? "DISABLED" : "ACTIVE" },
                });
              }}
            >
              {detail.data.status === "ACTIVE" ? "Disable user" : "Enable user"}
            </button>
            <button
              type="button"
              onClick={() => {
                const demoting = detail.data.role === "ADMIN";
                if (demoting && !window.confirm("Revoke administrator access for this user?"))
                  return;
                action.mutate({
                  id: detail.data.id,
                  input: { role: demoting ? "USER" : "ADMIN" },
                });
              }}
            >
              {detail.data.role === "ADMIN" ? "Revoke admin" : "Grant admin"}
            </button>
            <button type="button" onClick={() => revoke.mutate()}>
              Revoke sessions
            </button>
          </div>
          <label>
            Temporary password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={password.length < 12}
            onClick={() => {
              if (window.confirm("Reset this password and revoke all active sessions?"))
                reset.mutate();
            }}
          >
            Reset password
          </button>
          <ActionError mutations={[action, reset, revoke]} />
        </section>
      ) : (
        <section className="settings-card">
          <p>Select a user to inspect safe account counts.</p>
        </section>
      )}
      {showCreate ? (
        <div className="modal-backdrop">
          <form
            className="operation-dialog settings-form"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-title"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(newUser);
            }}
          >
            <h2 id="create-user-title">Create user</h2>
            <label>
              Username
              <input
                required
                minLength={3}
                value={newUser.username}
                onChange={(event) => setNewUser({ ...newUser, username: event.target.value })}
              />
            </label>
            <label>
              Email
              <input
                required
                type="email"
                value={newUser.email}
                onChange={(event) => setNewUser({ ...newUser, email: event.target.value })}
              />
            </label>
            <label>
              Display name
              <input
                required
                value={newUser.displayName}
                onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })}
              />
            </label>
            <label>
              Temporary password
              <input
                required
                type="password"
                minLength={12}
                value={newUser.temporaryPassword}
                onChange={(event) =>
                  setNewUser({ ...newUser, temporaryPassword: event.target.value })
                }
              />
            </label>
            <label>
              Role
              <select
                value={newUser.role}
                onChange={(event) =>
                  setNewUser({ ...newUser, role: event.target.value as "USER" | "ADMIN" })
                }
              >
                <option value="USER">User</option>
                <option value="ADMIN">Admin</option>
              </select>
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button className="primary-action" type="submit" disabled={create.isPending}>
                Create user
              </button>
            </div>
            <ActionError mutations={[create]} />
          </form>
        </div>
      ) : null}
    </div>
  );
}

function Config() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "config"], queryFn: getAdminConfig });
  const [draft, setDraft] = useState<AdminConfigValues | null>(null);
  const [review, setReview] = useState(false);
  useEffect(() => {
    if (query.data && !draft) setDraft(query.data.values);
  }, [query.data, draft]);
  const mutation = useMutation({
    mutationFn: () => updateAdminConfig(query.data?.version ?? 0, draft as AdminConfigValues),
    onSuccess: (data) => {
      client.setQueryData(["admin", "config"], data);
      setDraft(data.values);
      setReview(false);
    },
  });
  if (!query.data || !draft) return <QueryState query={query} />;
  return (
    <section className="settings-card settings-form">
      <p>
        Version {query.data.version}. Edit a complete staged copy, review it, then explicitly apply.
      </p>
      {Object.entries(draft).map(([key, value]) => (
        <div className="setting-row" key={key}>
          <span>
            <strong>{title(key)}</strong>
            <small>{configDescription(key)}</small>
          </span>
          {typeof value === "boolean" ? (
            <input
              aria-label={title(key)}
              type="checkbox"
              checked={value}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })}
            />
          ) : (
            <input
              aria-label={title(key)}
              type="number"
              value={value}
              onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })}
            />
          )}
        </div>
      ))}
      <button type="button" className="primary-action" onClick={() => setReview(true)}>
        Review changes
      </button>
      {review ? (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="config-review-title"
            className="operation-dialog"
          >
            <h2 id="config-review-title">Review system settings</h2>
            <pre>{JSON.stringify(draft, null, 2)}</pre>
            <div className="dialog-actions">
              <button type="button" onClick={() => setReview(false)}>
                Back
              </button>
              <button type="button" className="primary-action" onClick={() => mutation.mutate()}>
                Apply settings
              </button>
            </div>
            <ActionError mutations={[mutation]} />
          </section>
        </div>
      ) : null}
    </section>
  );
}

function Security() {
  const query = useQuery({ queryKey: ["admin", "security"], queryFn: getAdminSecurity });
  if (!query.data) return <QueryState query={query} />;
  return (
    <section className="settings-card">
      <h2>Immutable protections</h2>
      {Object.entries(query.data.immutable).map(([key, value]) => (
        <label className="setting-row" key={key}>
          <span>
            <strong>{title(key)}</strong>
            <small>Deployment security floor; cannot be disabled.</small>
          </span>
          <input type="checkbox" checked={value} disabled readOnly />
        </label>
      ))}
    </section>
  );
}
function Jobs() {
  const client = useQueryClient();
  const [state, setState] = useState("");
  const [type, setType] = useState("");
  const query = useQuery({
    queryKey: ["admin", "jobs", state, type],
    queryFn: () => getAdminJobs({ ...(state ? { state } : {}), ...(type ? { type } : {}) }),
    refetchInterval: 3000,
  });
  const action = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: "retry" | "cancel" }) =>
      kind === "retry" ? retryAdminJob(id) : cancelAdminJob(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "jobs"] }),
  });
  if (!query.data) return <QueryState query={query} />;
  return (
    <section className="settings-card">
      <div className="admin-filters">
        <select
          aria-label="Filter job state"
          value={state}
          onChange={(event) => setState(event.target.value)}
        >
          <option value="">All states</option>
          {[
            "PENDING",
            "RUNNING",
            "SUCCEEDED",
            "SUCCEEDED_WITH_ISSUES",
            "FAILED",
            "CANCELLED",
            "INTERRUPTED",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Filter job type"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="">All types</option>
          {["PERMANENT_DELETE_FOLDER", "PERMANENT_DELETE_DOCUMENT", "IMPORT", "EXPORT"].map(
            (value) => (
              <option key={value}>{value}</option>
            ),
          )}
        </select>
      </div>
      <ul className="admin-list">
        {query.data.data.map((job) => {
          const running = job.state === "PENDING" || job.state === "RUNNING";
          const retryable =
            job.state === "FAILED" ||
            job.state === "INTERRUPTED" ||
            job.state === "SUCCEEDED_WITH_ISSUES";
          return (
            <li key={job.id}>
              <span>
                <strong>
                  {job.type} · {job.state}
                </strong>
                <small>
                  {job.owner.displayName} · {job.progress}% · attempts{" "}
                  {job.parentJobId ? "retry" : "original"}
                </small>
              </span>
              {running ? (
                <button type="button" onClick={() => action.mutate({ id: job.id, kind: "cancel" })}>
                  Cancel
                </button>
              ) : null}
              {retryable ? (
                <button type="button" onClick={() => action.mutate({ id: job.id, kind: "retry" })}>
                  Retry
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ActionError mutations={[action]} />
    </section>
  );
}
function Audit() {
  const [action, setAction] = useState("");
  const [result, setResult] = useState<"" | "SUCCESS" | "FAILURE">("");
  const query = useQuery({
    queryKey: ["admin", "audit", action, result],
    queryFn: () => getAdminAudit({ action, ...(result ? { result } : {}) }),
  });
  if (!query.data) return <QueryState query={query} />;
  return (
    <section className="settings-card">
      <div className="admin-filters">
        <input
          aria-label="Filter audit action"
          placeholder="Action contains…"
          value={action}
          onChange={(event) => setAction(event.target.value)}
        />
        <select
          aria-label="Filter audit result"
          value={result}
          onChange={(event) => setResult(event.target.value as typeof result)}
        >
          <option value="">All results</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILURE">Failure</option>
        </select>
      </div>
      <ul className="admin-list">
        {query.data.data.map((event) => (
          <li key={event.id}>
            <span>
              <strong>
                {event.action} · {event.result}
              </strong>
              <small>
                {new Date(event.occurredAt).toLocaleString()} ·{" "}
                {event.actor?.displayName ?? "System"} · request {event.requestId}
              </small>
              <code>{JSON.stringify(event.metadata)}</code>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
function System() {
  const query = useQuery({
    queryKey: ["admin", "health"],
    queryFn: getAdminHealth,
    enabled: false,
  });
  return (
    <section className="settings-card">
      <button type="button" className="primary-action" onClick={() => query.refetch()}>
        Run health check
      </button>
      {query.data ? (
        <dl>
          <dt>Status</dt>
          <dd>{query.data.status}</dd>
          <dt>API</dt>
          <dd>{query.data.apiVersion}</dd>
          <dt>Database</dt>
          <dd>{query.data.databaseVersion}</dd>
          <dt>Migrations</dt>
          <dd>{query.data.migrationCount}</dd>
          <dt>Worker last seen</dt>
          <dd>{query.data.workerLastSeenAt ?? "Unknown"}</dd>
        </dl>
      ) : null}
      <QueryState query={query} idle />
    </section>
  );
}
function QueryState({
  query,
  idle = false,
}: {
  readonly query: { isPending: boolean; isError: boolean; error: Error | null };
  readonly idle?: boolean;
}) {
  if (query.isError)
    return <p role="alert">{query.error?.message} Your data was not changed. Retry this panel.</p>;
  if (query.isPending && !idle) return <p role="status">Loading this panel…</p>;
  return null;
}
function ActionError({
  mutations,
}: {
  readonly mutations: readonly { isError: boolean; error: Error | null }[];
}) {
  const failure = mutations.find((item) => item.isError);
  return failure ? (
    <p role="alert">{failure.error?.message} Your prior data is unchanged; review and retry.</p>
  ) : null;
}
function title(value: string) {
  return value.replace(/([A-Z])/gu, " $1").replace(/^./u, (letter) => letter.toUpperCase());
}

function configDescription(key: string): string {
  const descriptions: Record<string, string> = {
    documentMaxBytes: "Maximum UTF-8 size accepted for one Markdown document.",
    trashRetentionDays: "Days deleted items remain recoverable before cleanup.",
    versionRetentionDays: "Days immutable document versions remain available.",
    sessionTtlDays: "Maximum lifetime of newly issued sessions.",
    importMaxFiles: "Maximum files accepted in one import archive.",
    importMaxTotalBytes: "Maximum uncompressed bytes accepted per import.",
    exportDownloadTtlMinutes: "Minutes a generated export download remains available.",
    externalImagesEnabled: "Installation ceiling for loading remote images.",
  };
  return descriptions[key] ?? "Typed installation setting.";
}
