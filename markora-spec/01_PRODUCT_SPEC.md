# 01 — Product Specification

## 1. Outcomes

Users can build and maintain a durable Markdown knowledge base without managing files directly, switch between visual and source editing, find content quickly, recover from mistakes and failures, and export a clean portable Markdown tree. Administrators can operate the installation without gaining routine access to document content.

## 2. Actors and permissions

| Capability | User | Admin |
|---|---:|---:|
| Manage own folders/documents | Yes | Yes, in own workspace |
| Search/read own content | Yes | Yes, in own workspace |
| Import/export own workspace | Yes | Yes |
| Manage own profile/preferences/sessions | Yes | Yes |
| Create/disable users, reset password state | No | Yes |
| Revoke another user's sessions | No | Yes |
| View user content through admin UI/API | No | No |
| Configure system limits/security-allowed settings | No | Yes |
| View jobs/audit/health | No | Yes |

## 3. Primary journeys

### J1 — First entry

Admin starts a fresh deployment with one-time bootstrap credentials, changes the bootstrap password, creates a user, and the user signs in to an empty workspace. Empty state offers `New Document` and `Import Markdown`.

### J2 — Organize and write

User creates folders/documents, navigates tree → list → document, edits in WYSIWYG/Source/Split, sees `Saving…` then `Saved`, and returns via stable URL without losing selection or panel state.

### J3 — Find and navigate

User invokes Quick Open or Search, enters a query, changes scope, opens a result at the relevant match, or uses Command Palette for an action. Keyboard navigation and escape behavior are consistent.

### J4 — Recover content

User restores a trashed item, previews/restores an older version as a new current revision, recovers an unsaved local draft, or resolves a revision conflict without automatic overwrite.

### J5 — Move Markdown in/out

User drops `.md` files, a folder or ZIP, previews structure/warnings/conflicts, selects Keep Both/Skip/Replace, starts the import, monitors a background job, and retries failed items. Downloads/exports preserve the visible hierarchy and original Markdown.

### J6 — Operate the system

Admin manages user status/sessions, reviews pending configuration changes before applying them, inspects failed jobs/audit events/health, and retries or cancels jobs when allowed.

## 4. Functional capability map

### Authentication and accounts

- No public registration route or page.
- Bootstrap admin is created only when no users exist, using explicit environment-provided bootstrap values or a one-time deployment command.
- Passwords use a memory-hard password hash. Login is rate-limited and audited.
- User can change password after confirming current password; admin reset forces a change on next login.
- Sessions can be individually revoked; “sign out all other sessions” preserves current session.

### Workspace, folder and document

- Implicit root; arbitrary nested folders within configured depth.
- Create/rename/move use the shared naming policy. Move rejects cycles and sibling collision.
- Document list supports sort, filter and selection; folder tree owns hierarchy only.
- Bulk move, download and trash operate on an explicit selection and return itemized errors for partial failures where atomicity is not promised.
- Stable deep link uses document ID, not path.

### Editor

- Modes: WYSIWYG, Source, Split. Split has source + rendered/visual counterpart; it is not two independent documents.
- Auto-save is default on, debounced, status-visible, and revision-guarded.
- Outline follows headings and navigates without mutating content.
- Slash commands insert supported blocks. Source has line numbers preference, wrap and tab size.
- Large-document threshold may force/recommend Source mode and degrade expensive live rendering.

### Search and commands

- Quick Open prioritizes names and recent documents.
- Full search covers names and Markdown text, with All / Current Folder / Current Folder + Children scopes and optional code-block inclusion.
- Search result shows name, path, snippet and match emphasis; no result state suggests scope/query changes.
- Command Palette exposes only actions valid for current context and role.
- CJK search quality is a release benchmark; no external engine is assumed.

### Versioning, trash and deletion

- Versions are immutable and carry creator/time/reason/source revision.
- Protected operations (import Replace, restore, destructive content replacement) create a snapshot.
- Restore creates a new version/current revision; history is never rewritten.
- Trash preserves subtree identity and original parent reference when possible.
- Restore conflict offers Keep Both or choose another target; it never overwrites silently.
- Permanent delete requires confirmation; large subtree deletion is a job.

### Import/export

- Sources: files, folder, ZIP. Preview is mandatory before execution.
- Ignore non-`.md` files and report one aggregate count; do not interrupt per file.
- Validate encoding, archive traversal, symlinks, compression ratio, total uncompressed size, file count, depth and Markdown size.
- Conflict choices: Keep Both (default), Skip, Replace; batch can apply a choice to all conflicts.
- Import reports imported/skipped/failed/normalized items and allows retry of failed items only.
- Single selection downloads `.md`; multi-selection/folder/workspace produces ZIP.
- Export never changes editor state and uses raw Markdown, not HTML.

### Settings and admin

- Personal: profile, appearance, editor/Markdown, documents, search, sessions, account.
- Admin: overview, users, system settings, security, jobs, audit, system status.
- Preferences save inline; admin changes are staged, reviewed, validated, explicitly applied and audited.
- Security status may be read-only. Sanitization/script/unsafe URL floors cannot be disabled.

## 5. Non-functional product requirements

- WCAG 2.2 AA target for core workflows; full keyboard access; visible focus; reduced motion.
- Common local interactions should feel immediate; show local feedback under 100 ms, skeleton after 200 ms, progress for long work.
- No full-screen loading for local panel refreshes.
- Error messages state event, data safety and next action; user UI never shows stack traces.
- All destructive, privileged, authentication, export and security-relevant operations are audited without Markdown bodies.

## 6. Success criteria

V1 succeeds when a user can create/import a 300+ document hierarchy, edit and recover a document safely, find English and representative CJK content, export an equivalent Markdown tree, and an admin can diagnose failures—while all workspace isolation, conflict and security tests pass.

