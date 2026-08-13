import type { PreferenceResponse, PreferenceSettings, Principal } from "@markora/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { applyPreferences } from "./preferences.js";
import { getPreferences, updatePreferences } from "./settings-api.js";
import { GlobalRail } from "./WorkspacePage.js";

const categories = [
  "profile",
  "appearance",
  "editor",
  "documents",
  "search",
  "sessions",
  "account",
] as const;

export function SettingsPage({
  principal,
  onLogout,
  sessions,
}: {
  readonly principal: Principal;
  readonly onLogout: () => void | Promise<void>;
  readonly sessions: React.ReactNode;
}) {
  const category = useParams().category ?? "appearance";
  return (
    <div className="app-shell settings-layout">
      <GlobalRail principal={principal} onLogout={onLogout} current="settings" />
      <aside className="settings-nav panel" aria-label="Settings categories">
        <p className="eyebrow">PERSONAL</p>
        <h2>Settings</h2>
        {categories.map((item) => (
          <Link
            key={item}
            className={category === item ? "active" : undefined}
            to={`/settings/${item}`}
          >
            {label(item)}
          </Link>
        ))}
      </aside>
      {category === "sessions" ? (
        sessions
      ) : category === "account" ? (
        <AccountPanel onLogout={onLogout} />
      ) : (
        <PreferencePanel category={category} principal={principal} />
      )}
    </div>
  );
}

export function PreferenceRuntime() {
  const query = useQuery({ queryKey: ["preferences"], queryFn: getPreferences, staleTime: 60_000 });
  useEffect(() => {
    if (query.data) applyPreferences(query.data.settings);
  }, [query.data]);
  return null;
}

function PreferencePanel({
  category,
  principal,
}: {
  readonly category: string;
  readonly principal: Principal;
}) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["preferences"], queryFn: getPreferences });
  const [draftName, setDraftName] = useState(principal.displayName);
  const confirmed = useRef<PreferenceResponse | null>(null);
  if (!confirmed.current && query.data) confirmed.current = query.data;
  const mutation = useMutation({
    scope: { id: "preference-auto-save" },
    mutationFn: ({
      patch,
      displayName,
    }: {
      patch: Partial<PreferenceSettings>;
      displayName?: string;
    }) => {
      if (!confirmed.current) throw new Error("Preferences are not ready yet.");
      return updatePreferences(confirmed.current.version, patch, displayName);
    },
    onMutate: ({ patch, displayName }) => {
      const previous = client.getQueryData<PreferenceResponse>(["preferences"]);
      if (previous) {
        const optimistic = {
          ...previous,
          ...(displayName ? { displayName } : {}),
          settings: { ...previous.settings, ...patch },
        };
        client.setQueryData(["preferences"], optimistic);
        applyPreferences(optimistic.settings);
      }
      return { previous };
    },
    onSuccess: (next) => {
      confirmed.current = next;
      client.setQueryData(["preferences"], next);
      applyPreferences(next.settings);
    },
    onError: () => {
      if (confirmed.current) {
        client.setQueryData(["preferences"], confirmed.current);
        applyPreferences(confirmed.current.settings);
      }
    },
  });
  const data = query.data;
  const save = (patch: Partial<PreferenceSettings>) => {
    if (confirmed.current) mutation.mutate({ patch });
  };
  return (
    <main className={`settings-surface panel preference-surface preference-category-${category}`}>
      <header className="settings-header">
        <p className="eyebrow">PERSONAL SETTINGS</p>
        <h1>{label(category)}</h1>
        <p>Changes save automatically and stay scoped to your account.</p>
        <PreferenceStatus queryPending={query.isPending} mutation={mutation} />
      </header>
      {data ? (
        <section
          className={`settings-card settings-form${category === "editor" ? " settings-editor-scroll" : ""}`}
        >
          {category === "profile" ? (
            <>
              <Setting label="Display name">
                <input
                  aria-label="Display name"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={() => {
                    if (draftName.trim() && draftName !== data.displayName)
                      mutation.mutate({ patch: {}, displayName: draftName.trim() });
                  }}
                />
              </Setting>
              <Setting label="Username">
                <input aria-label="Username" value={principal.username} readOnly disabled />
              </Setting>
              <Setting label="Email">
                <input aria-label="Email" value={principal.email} readOnly disabled />
              </Setting>
              <Setting label="Language">
                <select
                  value={data.settings.language}
                  onChange={(event) =>
                    save({ language: event.target.value as PreferenceSettings["language"] })
                  }
                >
                  <option value="en">English</option>
                  <option value="zh-CN">简体中文</option>
                </select>
              </Setting>
            </>
          ) : null}
          {category === "appearance" ? (
            <>
              <Choice
                label="Theme"
                value={data.settings.theme}
                values={["LIGHT", "DARK", "SYSTEM"]}
                onChange={(theme) => save({ theme: theme as PreferenceSettings["theme"] })}
              />
              <Choice
                label="Accent"
                value={data.settings.accent}
                values={["BLUE", "INDIGO", "TEAL"]}
                onChange={(accent) => save({ accent: accent as PreferenceSettings["accent"] })}
              />
              <Choice
                label="Density"
                value={data.settings.density}
                values={["COMFORTABLE", "COMPACT"]}
                onChange={(density) => save({ density: density as PreferenceSettings["density"] })}
              />
              <NumberSetting
                label="Interface font size"
                value={data.settings.interfaceFontSize}
                min={12}
                max={20}
                onChange={(interfaceFontSize) => save({ interfaceFontSize })}
              />
            </>
          ) : null}
          {category === "editor" ? (
            <>
              <Choice
                label="Default mode"
                value={data.settings.defaultEditorMode}
                values={["wysiwyg", "source", "split"]}
                onChange={(defaultEditorMode) =>
                  save({
                    defaultEditorMode: defaultEditorMode as PreferenceSettings["defaultEditorMode"],
                  })
                }
              />
              <NumberSetting
                label="Reading width"
                value={data.settings.readingWidth}
                min={560}
                max={1400}
                step={40}
                onChange={(readingWidth) => save({ readingWidth })}
              />
              <NumberSetting
                label="Editor font size"
                value={data.settings.editorFontSize}
                min={12}
                max={24}
                onChange={(editorFontSize) => save({ editorFontSize })}
              />
              <NumberSetting
                label="Line height"
                value={data.settings.editorLineHeight}
                min={1.2}
                max={2.2}
                step={0.1}
                onChange={(editorLineHeight) => save({ editorLineHeight })}
              />
              <Choice
                label="Tab size"
                value={String(data.settings.tabSize)}
                values={["2", "4"]}
                onChange={(tabSize) => save({ tabSize: Number(tabSize) as 2 | 4 })}
              />
              <Toggle
                label="Wrap long lines"
                checked={data.settings.wrap}
                onChange={(wrap) => save({ wrap })}
              />
              <Toggle
                label="Show outline"
                checked={data.settings.outline}
                onChange={(outline) => save({ outline })}
              />
              <Toggle
                label="Source line numbers"
                checked={data.settings.sourceLineNumbers}
                onChange={(sourceLineNumbers) => save({ sourceLineNumbers })}
              />
              <Toggle
                label="Auto-save"
                checked={data.settings.autoSave}
                onChange={(autoSave) => save({ autoSave })}
              />
              <Toggle
                label="Mermaid diagrams"
                checked={data.settings.mermaid}
                onChange={(mermaid) => save({ mermaid })}
              />
              <Toggle
                label="Math rendering"
                checked={data.settings.math}
                onChange={(math) => save({ math })}
              />
              <Toggle
                label="Load external images"
                checked={data.settings.externalImages}
                disabled={!data.capabilities.externalImages}
                onChange={(externalImages) => save({ externalImages })}
              />
              <Choice
                label="Open links"
                value={data.settings.linkTarget}
                values={["SAME_TAB", "NEW_TAB"]}
                onChange={(linkTarget) =>
                  save({ linkTarget: linkTarget as PreferenceSettings["linkTarget"] })
                }
              />
            </>
          ) : null}
          {category === "documents" ? (
            <>
              <Choice
                label="Default sort"
                value={data.settings.documentSort}
                values={["UPDATED", "NAME"]}
                onChange={(documentSort) =>
                  save({ documentSort: documentSort as PreferenceSettings["documentSort"] })
                }
              />
              <Choice
                label="Direction"
                value={data.settings.documentDirection}
                values={["ASC", "DESC"]}
                onChange={(documentDirection) =>
                  save({
                    documentDirection: documentDirection as PreferenceSettings["documentDirection"],
                  })
                }
              />
              <Toggle
                label="Remember expanded folders"
                checked={data.settings.rememberExpandedFolders}
                onChange={(rememberExpandedFolders) => save({ rememberExpandedFolders })}
              />
              <Toggle
                label="Restore last workspace state"
                checked={data.settings.restoreLastWorkspaceState}
                onChange={(restoreLastWorkspaceState) => save({ restoreLastWorkspaceState })}
              />
            </>
          ) : null}
          {category === "search" ? (
            <>
              <Choice
                label="Default scope"
                value={data.settings.searchScope}
                values={["WORKSPACE", "CURRENT_FOLDER"]}
                onChange={(searchScope) =>
                  save({ searchScope: searchScope as PreferenceSettings["searchScope"] })
                }
              />
              <Toggle
                label="Include code blocks"
                checked={data.settings.includeCodeBlocks}
                onChange={(includeCodeBlocks) => save({ includeCodeBlocks })}
              />
              <Setting label="Search history">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => localStorage.removeItem("markora.search-history.v1")}
                >
                  Clear history
                </button>
              </Setting>
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function PreferenceStatus({
  queryPending,
  mutation,
}: {
  readonly queryPending: boolean;
  readonly mutation: { isPending: boolean; isError: boolean; error: Error | null };
}) {
  if (queryPending) return <span role="status">Loading…</span>;
  if (mutation.isPending) return <span role="status">Saving…</span>;
  if (mutation.isError)
    return (
      <span role="alert">
        Save failed. Your previous setting is still active. {mutation.error?.message}
      </span>
    );
  return <span role="status">Saved</span>;
}
function Setting({
  label: text,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <span>
        <strong>{text}</strong>
      </span>
      {children}
    </div>
  );
}
function Choice({
  label: text,
  value,
  values,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly values: readonly string[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <Setting label={text}>
      <select aria-label={text} value={value} onChange={(event) => onChange(event.target.value)}>
        {values.map((item) => (
          <option key={item}>{item}</option>
        ))}
      </select>
    </Setting>
  );
}
function Toggle({
  label: text,
  checked,
  disabled = false,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <Setting label={text}>
      <input
        aria-label={text}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </Setting>
  );
}
function NumberSetting({
  label: text,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <Setting label={text}>
      <input
        aria-label={text}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Setting>
  );
}
function AccountPanel({ onLogout }: { readonly onLogout: () => void | Promise<void> }) {
  return (
    <main className="settings-surface panel">
      <header className="settings-header">
        <p className="eyebrow">PERSONAL SETTINGS</p>
        <h1>Account</h1>
        <p>
          Password changes are available from the secure account flow. Account deletion is not part
          of V1.
        </p>
      </header>
      <button type="button" className="secondary-action" onClick={onLogout}>
        Sign out
      </button>
    </main>
  );
}
function label(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
