import type { Principal, SessionSummary } from "@markora/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import {
  changePassword,
  getCurrentPrincipal,
  listSessions,
  login,
  logout,
  revokeOtherSessions,
  revokeSession,
} from "./auth-api.js";
import { TrashPage } from "./TrashPage.js";
import { GlobalRail, WorkspacePage } from "./WorkspacePage.js";

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
        path="/trash"
        element={<TrashPage principal={principalQuery.data} onLogout={onLogout} />}
      />
      <Route
        path="/"
        element={<WorkspacePage principal={principalQuery.data} onLogout={onLogout} />}
      />
      <Route
        path="/documents/:documentId"
        element={<WorkspacePage principal={principalQuery.data} onLogout={onLogout} />}
      />
      <Route
        path="/settings/sessions"
        element={<SettingsShell principal={principalQuery.data} onLogout={onLogout} />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function SettingsShell({
  principal,
  onLogout,
}: {
  readonly principal: Principal;
  readonly onLogout: () => void | Promise<void>;
}) {
  return (
    <div className="app-shell settings-layout">
      <GlobalRail principal={principal} onLogout={onLogout} current="settings" />
      <SessionSettings />
    </div>
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
