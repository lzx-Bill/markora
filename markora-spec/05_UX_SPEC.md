# 05 — UX and Visual Specification

## 1. Visual contract

Approved reference: `assets/ui-reference.png`.

The UI must feel like a modern knowledge workspace, not an admin dashboard: warm neutral background, subtly separated zones, floating translucent/solid panels, soft border/shadow, restrained blue accent, and a paper-like reading surface. Use design tokens rather than per-page styling. Motion is short and functional; respect reduced motion. Light/Dark/System themes must preserve hierarchy and contrast.

The image is authoritative for direction and spatial hierarchy, not literal features. Remove Favorites and Share in V1. Do not copy accidental text/content, exact pixel dimensions, or non-accessible contrast.

## 2. Desktop shell

Four functional zones:

1. **Global rail**: workspace identity; Documents, Search, Trash, Settings; Admin for admins.
2. **Folder drawer**: `My Documents`, tree, create/collapse controls.
3. **Document drawer**: breadcrumb/context, count/sort/filter/create, selectable list.
4. **Work surface**: document header/status/actions, mode toolbar, editor paper, optional Outline drawer.

Panels can collapse without losing selection. The editor receives remaining width and never falls below usable minimum. Deep link preserves current document; refresh restores it. Folder/list loading cannot blank the editor.

Responsive behavior:

- `>=1280px`: all primary zones available; outline overlays/docks based on width.
- `768–1279px`: global rail compact; folder/list drawers mutually collapsible; editor primary.
- `<768px`: one primary pane at a time with back navigation; Source/WYSIWYG supported, Split disabled; no horizontal desktop squeeze.

## 3. Navigation, tree and list

- Tree displays folders only, expands lazily, remembers expanded folders if preference enabled, and supports keyboard tree semantics.
- Document count meaning is consistent and labeled in accessibility text (direct or recursive—choose one and use it everywhere; provisional: recursive).
- Document list displays name, modified relative time and relevant state only. Sorting: Modified/Name/Created + direction. Selection bar: Move, Download, Trash.
- Clicking a folder changes list context; clicking a document changes editor. Current editing document is not closed by unrelated tree/list refresh.
- Rename is inline where safe; Escape cancels, Enter submits; optimistic response rolls back on failure.
- Drag/drop move provides valid target highlight, collision/cycle validation, undo toast on success where domain permits.
- Empty folder: concise explanation + `New Document` primary and `Import` secondary.

## 4. Editor UX

### Header and modes

Header shows document name, save/sync state and contextual overflow actions. Mode tabs: WYSIWYG, Source, Split. Toolbar adapts to mode. Outline is optional and generated from headings; clicking scrolls and updates active section.

### Save state machine

`Saved → Dirty → Saving → Saved`  
Failures: `Saving → Save Failed (Local Draft Safe) → Retrying/Saving`  
Network: `Dirty/Saving → Offline (Local Draft Safe) → Reconnecting → Saved | Conflict`

Status copy must be truthful: `Saving…`, `Saved`, `Offline — changes saved locally`, `Save failed — changes remain on this device`, `Conflict — review changes`. Do not show “Auto-saved” before server acknowledgement.

Auto-save is debounced; a newer client change supersedes an unsent request but not an in-flight revision contract. Navigation silently flushes when possible. Warn only when unsynchronized local changes remain.

### Markdown behavior

- Opening or mode switching alone does not rewrite Markdown.
- Unsupported syntax becomes a clearly marked raw Markdown block in WYSIWYG.
- Mermaid/math render errors are isolated and offer `Edit source`.
- WYSIWYG initialization failure offers `Open Source Mode`; document remains safe.
- Large document mode explains reduced features and recommends/forces Source according to configured threshold.
- URL image placeholder states loading/blocked/failed; it never breaks editing.

### Conflict panel

On revision conflict, stop auto-save and preserve local draft. Show server time/revision and local time. Actions: `Review changes`, `Keep server version` (after explicit warning about local draft), `Save local as current` only after rebase/explicit protected operation, or copy/download local Markdown. Never auto-merge unless a deterministic, tested merge produces a reviewable result; V1 may present a diff and manual resolution.

## 5. Search, Quick Open and Command Palette

- Global shortcuts: Quick Open (`Ctrl/Cmd+P`), Search (`Ctrl/Cmd+Shift+F`), Command Palette (`Ctrl/Cmd+K` or documented non-conflicting binding).
- Overlays trap focus correctly, support arrow navigation, Enter action, Escape close and return focus.
- Quick Open searches name/path and recency; no destructive actions.
- Search page/overlay supports query, scope, include-code-block preference, result snippet/path and progressive pagination.
- Command Palette groups navigation/create/editor actions and hides role/state-invalid commands.
- Empty search suggests query/scope changes; error preserves query and offers retry.

## 6. Trash and version history

Trash shows trashed root items with type, original path, deletion time and retention. Restore defaults to original parent; missing/conflicting parent invokes target chooser and Keep Both. Permanent delete uses clear application-level irreversibility wording and stronger confirmation for folders/bulk items.

Version History opens as a side panel/page without replacing current content. Selecting a version shows timestamp, actor/reason and diff/preview. Restore states: confirm → server operation → new current revision → success. It never edits historical rows. Current unsaved local work blocks or requires explicit recovery handling before restore.

## 7. Import UX

Entry points: toolbar, empty state, drag/drop, command palette. Flow:

1. Select/drop `.md`, folder or ZIP.
2. Analyze with local/server progress; show preview tree.
3. Summarize document/folder counts, target, ignored non-Markdown count, warnings and limits.
4. Resolve conflicts: Keep Both (recommended/default), Skip, Replace; `Apply to all conflicts`.
5. Replace copy: `Existing content will be preserved in Version History.`
6. Execute; modal may close via `Run in background`.
7. Result: imported/skipped/failed/normalized counts; `View report`, `Retry failed`, `View folder`.

Do not show one warning modal per ignored file. Interrupted jobs show processed count and `Resume` only when backend supports safe checkpoint resume; V1 does not promise full rollback. Never label a non-atomic partial import as rolled back.

## 8. Download/export UX

- Single document `Download .md` starts directly.
- Multi-selection and folder `Download` generate a hierarchy-preserving ZIP.
- `Export Workspace` lives in Settings/Command Palette and uses a simple count confirmation—Markdown ZIP is the only V1 format.
- Small work shows `Preparing download…`; large work becomes a background job with progress and `Download ZIP` when ready.
- Filename normalization is reported, does not rename database items, and does not interrupt editing.

## 9. Settings UX

Independent settings surface with left categories and paper-like content area:

- Profile: display name, username/email where policy allows, language, initial avatar.
- Appearance: Light/Dark/System, approved accent presets, Comfortable/Compact, interface font size.
- Editor/Markdown: default mode, reading width, font size, line height, wrap, tab 2/4, outline, source line numbers, auto-save, Mermaid/math display, external image loading, link target.
- Documents: default sort/direction, remember expanded folders, restore last workspace state.
- Search: default scope, include code blocks, clear history.
- Sessions: current device, safe summaries, revoke, sign out others.
- Account: change password, sign out. Do not show unimplemented account deletion.

Preferences save automatically with inline `Saving/Saved/Error` and rollback/retry behavior.

## 10. Admin UX

Separate admin space, invisible and inaccessible to users:

- Overview: API/PostgreSQL/Worker status, user/document/job/storage summaries, recent issues.
- Users: search/filter, metadata detail, enable/disable, revoke sessions, reset password state, grant/revoke admin with last-admin safeguards. No names/paths/bodies of user documents.
- System Settings: documents, import/export, versions, sessions, Markdown policy within allowed bounds. Explain each field.
- Security: effective login/content/import floors; immutable protections appear read-only.
- Jobs: state filters, owner/type/progress/timing/retries/failure; valid Cancel/Retry only.
- Audit: time/user/action/result filters and metadata detail, never Markdown.
- System: health, app/database/build versions, uptime, `Run health check`; not an SSH console.

Admin config changes are staged, reviewed and explicitly saved. Dangerous operations use proportional confirmation; not every admin button is red.

## 11. Error, empty, loading and recovery

Use the smallest scope: inline/toast for light failures, panel/dialog for conflicts, full state only when the required app shell cannot load. Error copy always explains what happened, data safety and next action. Never show raw 500/stack traces.

Use local skeletons: tree, list, document paper, search rows. Save uses status text, not blocking loader. Optimistic rename/move/trash/restore rolls back on failure. Permanent delete, version restore, import and conflict resolution wait for confirmed server state.

Emergency local draft record: document ID, base revision, Markdown, timestamp and schema version in IndexedDB. On server save success, remove only the matching/superseded draft. On crash/reopen, compare local/server timestamps and revisions and offer Review, Restore Draft, Discard. Never auto-overwrite server content.

Offline allows continued editing only for the already-open document. It does not promise tree/search/other-document access. Connection restoration checks revision before sync. Initial total API failure may show a full connection page; if editor content exists, keep it accessible.

## 12. Accessibility and visual QA

All actions have accessible names/tooltips; color is not the only state indicator; focus order follows spatial order; dialogs announce title/description; tree/list/menus use correct semantics. Editor zoom/text settings do not clip controls at 200%. Visual regression covers light/dark, desktop/tablet/mobile, long names, empty/loading/error, conflict, import progress and large document states.

