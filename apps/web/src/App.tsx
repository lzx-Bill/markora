import type { Principal, SessionSummary } from "@markora/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import {
  changePassword,
  getCurrentPrincipal,
  listSessions,
  login,
  logout,
  revokeOtherSessions,
  revokeSession,
} from "./auth-api.js";

const folders = [
  { name: "Architecture", count: 23, active: true },
  { name: "Memory", count: 18 },
  { name: "Learning", count: 12 },
  { name: "Data", count: 16 },
];

const documents = [
  { name: "Welcome to Markora.md", updated: "Just now" },
  { name: "Architecture Notes.md", updated: "Yesterday" },
  { name: "Reading List.md", updated: "3 days ago" },
];

type EditorMode = "WYSIWYG" | "Source" | "Split";

export function App() {
  return (
    <Routes>
      <Route path="*" element={<AuthGate />} />
    </Routes>
  );
}

function AuthGate() {
  const queryClient = useQueryClient();
  const principalQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: getCurrentPrincipal,
    retry: false,
  });

  if (principalQuery.isPending) {
    return (
      <div className="auth-status" role="status">
        Opening your workspace…
      </div>
    );
  }
  if (principalQuery.isError) {
    return (
      <div className="auth-status" role="alert">
        <strong>Markora could not connect.</strong>
        <button type="button" onClick={() => principalQuery.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (!principalQuery.data) {
    return (
      <LoginPage
        onAuthenticated={(principal) => queryClient.setQueryData(["auth", "me"], principal)}
      />
    );
  }
  if (principalQuery.data.mustChangePassword) {
    return (
      <ChangePasswordPage
        principal={principalQuery.data}
        onChanged={() =>
          queryClient.setQueryData(["auth", "me"], {
            ...principalQuery.data,
            mustChangePassword: false,
          })
        }
      />
    );
  }
  const onLogout = async () => {
    await logout();
    queryClient.setQueryData(["auth", "me"], null);
  };
  return (
    <Routes>
      <Route
        path="/"
        element={<WorkspaceShell principal={principalQuery.data} onLogout={onLogout} />}
      />
      <Route
        path="/settings/sessions"
        element={
          <WorkspaceShell principal={principalQuery.data} onLogout={onLogout} section="sessions" />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function LoginPage({ onAuthenticated }: { onAuthenticated: (principal: Principal) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = useMutation({
    mutationFn: () => login(identifier, password),
    onSuccess: onAuthenticated,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate();
  }

  return (
    <main className="auth-canvas">
      <section className="auth-card" aria-labelledby="login-heading">
        <span className="brand-mark auth-mark" aria-hidden="true">
          M
        </span>
        <p className="eyebrow">MARKORA</p>
        <h1 id="login-heading">Return to your knowledge space.</h1>
        <p className="auth-intro">Sign in with the account provided by your administrator.</p>
        <form onSubmit={submit}>
          <label htmlFor="identifier">Username or email</label>
          <input
            id="identifier"
            name="identifier"
            autoComplete="username"
            required
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {loginMutation.isError ? (
            <p className="form-error" role="alert">
              {loginMutation.error.message}
            </p>
          ) : null}
          <button
            className="primary-action auth-submit"
            type="submit"
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <small>Accounts are created by your Markora administrator.</small>
      </section>
    </main>
  );
}

function ChangePasswordPage({
  principal,
  onChanged,
}: {
  principal: Principal;
  onChanged: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const passwordMutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: onChanged,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmation) return;
    passwordMutation.mutate();
  }

  const mismatch = confirmation.length > 0 && newPassword !== confirmation;
  return (
    <main className="auth-canvas">
      <section className="auth-card" aria-labelledby="password-heading">
        <span className="brand-mark auth-mark" aria-hidden="true">
          M
        </span>
        <p className="eyebrow">WELCOME, {principal.displayName.toUpperCase()}</p>
        <h1 id="password-heading">Choose your own password.</h1>
        <p className="auth-intro">
          The bootstrap or reset password must be replaced before continuing.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {mismatch ? (
            <p className="form-error" role="alert">
              Passwords do not match.
            </p>
          ) : null}
          {passwordMutation.isError ? (
            <p className="form-error" role="alert">
              {passwordMutation.error.message}
            </p>
          ) : null}
          <button
            className="primary-action auth-submit"
            type="submit"
            disabled={mismatch || passwordMutation.isPending}
          >
            {passwordMutation.isPending ? "Saving…" : "Change password"}
          </button>
        </form>
      </section>
    </main>
  );
}

interface WorkspaceShellProps {
  readonly principal: Principal;
  readonly onLogout: () => void | Promise<void>;
  readonly section?: "documents" | "sessions";
}

export function WorkspaceShell({
  principal,
  onLogout,
  section = "documents",
}: WorkspaceShellProps) {
  const [mode, setMode] = useState<EditorMode>("WYSIWYG");
  const [selectedDocument, setSelectedDocument] = useState(documents[0]?.name ?? "");

  return (
    <div className={`app-shell ${section === "sessions" ? "settings-layout" : ""}`}>
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
              className={section === "documents" ? "active" : undefined}
              to="/"
              aria-label="Documents"
            >
              ▤ <span>Documents</span>
            </Link>
          </li>
          <li>
            <a href="#search" aria-label="Search">
              ⌕ <span>Search</span>
            </a>
          </li>
          <li>
            <a href="#trash" aria-label="Trash">
              ♲ <span>Trash</span>
            </a>
          </li>
          <li>
            <Link
              className={section === "sessions" ? "active" : undefined}
              to="/settings/sessions"
              aria-label="Settings"
            >
              ⚙ <span>Settings</span>
            </Link>
          </li>
        </ul>
        <div className="rail-footer">
          <button
            className="secondary-action"
            type="button"
            onClick={onLogout}
            aria-label="Sign out"
          >
            Sign out
          </button>
          <button className="primary-action" type="button">
            ＋ New Document
          </button>
        </div>
      </nav>

      {section === "sessions" ? (
        <SessionSettings />
      ) : (
        <>
          <aside className="folder-drawer panel" aria-labelledby="folders-heading">
            <div className="panel-heading">
              <h2 id="folders-heading">My Documents</h2>
              <button className="icon-button" type="button" aria-label="Create folder">
                ＋
              </button>
            </div>
            <nav aria-label="Folders">
              <ul className="tree">
                <li>
                  <button className="tree-root" type="button" aria-expanded="true">
                    ⌄　▢ AI
                  </button>
                  <ul>
                    {folders.map((folder) => (
                      <li className={folder.active ? "active" : undefined} key={folder.name}>
                        <button type="button" aria-current={folder.active ? "page" : undefined}>
                          <span>▢ {folder.name}</span>
                          <small>{folder.count}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              </ul>
            </nav>
          </aside>

          <aside className="document-drawer panel" aria-labelledby="documents-heading">
            <div className="document-heading">
              <p>AI / Architecture</p>
              <div className="panel-heading">
                <h2 id="documents-heading">23 documents</h2>
                <button className="icon-button accent" type="button" aria-label="Create document">
                  ＋
                </button>
              </div>
            </div>
            <ul className="document-list">
              {documents.map((document) => (
                <li key={document.name}>
                  <button
                    className={selectedDocument === document.name ? "selected" : undefined}
                    type="button"
                    onClick={() => setSelectedDocument(document.name)}
                  >
                    <span className="document-icon" aria-hidden="true">
                      ▤
                    </span>
                    <span>
                      <strong>{document.name}</strong>
                      <small>{document.updated}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <main className="work-surface" id="documents">
            <header className="document-header">
              <div>
                <h1>{selectedDocument}</h1>
                <span className="save-status">
                  <i /> Saved
                </span>
              </div>
              <button className="icon-button" type="button" aria-label="Document actions">
                •••
              </button>
            </header>
            <div className="editor-toolbar" role="toolbar" aria-label="Editor mode">
              {(["WYSIWYG", "Source", "Split"] as const).map((item) => (
                <button
                  className={mode === item ? "active" : undefined}
                  key={item}
                  type="button"
                  aria-pressed={mode === item}
                  onClick={() => setMode(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="editor-stage">
              <article className="editor-paper" aria-label="Document editor preview">
                <p className="eyebrow">MARKORA V1</p>
                <h2>A calm place for durable Markdown.</h2>
                <p>
                  Phase 1 secures this workspace with opaque sessions, explicit authentication
                  guards, and workspace-scoped identity. Document editing arrives as a safety-first
                  vertical slice.
                </p>
                <h3>Foundation first</h3>
                <ul>
                  <li>Opaque cookie sessions</li>
                  <li>Workspace-scoped identity</li>
                  <li>Audited recovery controls</li>
                </ul>
              </article>
              <aside className="outline" aria-labelledby="outline-heading">
                <h2 id="outline-heading">Outline</h2>
                <a className="active" href="#documents">
                  Foundation first
                </a>
              </aside>
            </div>
          </main>
        </>
      )}
    </div>
  );
}

function SessionSettings() {
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery({ queryKey: ["sessions"], queryFn: listSessions });
  const revokeMutation = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });
  const revokeOthersMutation = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });

  return (
    <main className="settings-surface panel">
      <header className="settings-header">
        <p className="eyebrow">PERSONAL SETTINGS</p>
        <h1>Sessions</h1>
        <p>Review signed-in devices and remove access you no longer recognize.</p>
      </header>
      <section className="settings-card" aria-labelledby="active-sessions-heading">
        <div className="settings-card-heading">
          <div>
            <h2 id="active-sessions-heading">Active sessions</h2>
            <p>Device descriptions are shortened and never include session tokens.</p>
          </div>
          <button
            className="secondary-action"
            type="button"
            disabled={revokeOthersMutation.isPending}
            onClick={() => revokeOthersMutation.mutate()}
          >
            {revokeOthersMutation.isPending ? "Signing out…" : "Sign out other sessions"}
          </button>
        </div>
        {sessionsQuery.isPending ? <p role="status">Loading sessions…</p> : null}
        {sessionsQuery.isError ? (
          <p className="form-error" role="alert">
            {sessionsQuery.error.message}
          </p>
        ) : null}
        {revokeMutation.isError || revokeOthersMutation.isError ? (
          <p className="form-error" role="alert">
            {(revokeMutation.error ?? revokeOthersMutation.error)?.message}
          </p>
        ) : null}
        {sessionsQuery.data ? (
          <ul className="session-list">
            {sessionsQuery.data.data.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                disabled={revokeMutation.isPending}
                onRevoke={() => revokeMutation.mutate(session.id)}
              />
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}

function SessionRow({
  session,
  disabled,
  onRevoke,
}: {
  readonly session: SessionSummary;
  readonly disabled: boolean;
  readonly onRevoke: () => void;
}) {
  const lastActive = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(session.lastActiveAt));
  return (
    <li>
      <span className="session-device" aria-hidden="true">
        ▣
      </span>
      <span>
        <strong>{session.current ? "Current session" : session.userAgentSummary}</strong>
        <small>{session.current ? session.userAgentSummary : `Last active ${lastActive}`}</small>
      </span>
      {session.current ? (
        <span className="current-badge">Current</span>
      ) : (
        <button className="secondary-action" type="button" disabled={disabled} onClick={onRevoke}>
          Revoke
        </button>
      )}
    </li>
  );
}
