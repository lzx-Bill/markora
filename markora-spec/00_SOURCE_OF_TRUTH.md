# 00 — Source of Truth

## 1. Product statement

Markora is a self-hostable, multi-user Markdown knowledge workspace. It organizes `.md` documents in a virtual folder hierarchy, provides safe online editing and rendering, search, version recovery, trash, import/export, and limited administration. Its primary experience is a calm “knowledge space”: a document appears as a floating sheet on a soft canvas, with surrounding panels acting as collapsible knowledge drawers.

## 2. Frozen V1 scope

### Included

- Username/email + password authentication; admin-provisioned users; bootstrap admin.
- Per-user workspace isolation and role-based admin access.
- Virtual folders and `.md` documents stored in PostgreSQL.
- Create, read, edit, rename, move, batch select, trash, restore, permanent delete.
- WYSIWYG, Source, and Split editor modes; auto-save; revision conflicts.
- GFM-class Markdown, code blocks, tables, task lists, links, URL images, Mermaid, math, safe raw HTML rendering, raw-preserved fallback.
- Folder tree, document list, breadcrumbs, outline, deep links.
- Quick Open, search, command palette.
- Version history and restore-as-new-version.
- Preview-first import of `.md`, folders, and ZIP; partial-success reporting.
- Download document/folder/selection and workspace export as original Markdown hierarchy.
- Personal settings; sessions; admin users, system settings, security status, jobs, audit and health.
- Emergency local draft for the currently open document; recovery after network/browser failure.
- Docker-based local and online deployment, reverse proxy, PostgreSQL, API, Web, database-backed worker. No Redis.

### Explicitly excluded

- Attachments or image upload; tags; favorites; duplicate; share/public links.
- Comments, real-time co-editing, teams, team workspaces, CRDT/OT.
- Public signup, email delivery, self-service forgotten-password email, OAuth/SSO.
- Full offline/PWA workspace, offline browsing/search/opening other documents.
- Trusted/unsanitized HTML, scripts, `javascript:` URLs, local file URLs.
- Redis, Elasticsearch, microservices, Kubernetes, analytics/BI, CI/CD design.

The prototype contains Favorites and Share affordances. They are **not V1 requirements and MUST be hidden**.

## 3. Canonical decisions

| ID | Decision |
|---|---|
| SOT-001 | Only files ending in `.md` are documents. `.markdown` and other files are ignored on import and reported in aggregate. |
| SOT-002 | A document has `name` (including `.md`) but no independent title metadata. The first H1 is content only. |
| SOT-003 | Folder path is derived; stable IDs are identity. Moves/renames do not change document URLs. |
| SOT-004 | Sibling names are unique under Unicode normalization and case-insensitive comparison. Naming policy is shared by UI, API, import and export. |
| SOT-005 | Markdown promises semantic preservation, not byte-for-byte round-trip after WYSIWYG edits. Opening without editing never rewrites content. Raw-preserved blocks remain byte-identical. Source mode is authoritative for exact formatting. |
| SOT-006 | Renderer always sanitizes raw HTML. No admin setting can disable the security floor. |
| SOT-007 | Auto-save uses optimistic concurrency with `revision`. A stale write never overwrites server state. |
| SOT-008 | Replace during import snapshots the existing version, then replaces current Markdown. |
| SOT-009 | Import is per-item partial success with report and retry-failed. V1 does not promise full-job rollback. |
| SOT-010 | Large permanent deletion is `Deleting` plus background batches with short transactions, not one large transaction. |
| SOT-011 | “Permanent” means unrecoverable through the application. Historical backups expire according to backup retention. |
| SOT-012 | Emergency local drafts protect the currently open document; they are not official storage or full offline support. |
| SOT-013 | PostgreSQL is the only durable store in V1. Temporary ZIP workspaces are ephemeral and automatically cleaned. |
| SOT-014 | User preferences auto-save. Admin system configuration uses review + explicit save and is audited. |
| SOT-015 | Admins can see metadata/usage but cannot read or edit user Markdown through admin capabilities. |
| SOT-016 | Export contains user-visible folder/document names and Markdown only—never database IDs or internal metadata files. |
| SOT-017 | Workspace export is based on a consistent logical snapshot. |
| SOT-018 | V1 does not require CI/CD. Build, migration, test and deployment procedures are still reproducible. |
| SOT-019 | Browser authentication uses a server-managed opaque session in a Secure/HttpOnly/SameSite cookie; only a hash is stored in PostgreSQL. V1 does not use stateless JWT access tokens. |
| SOT-020 | Password hashing uses Argon2id with parameters calibrated and recorded for target production hardware. |

## 4. Canonical vocabulary

- **Workspace**: one user-owned root namespace in V1.
- **Folder**: virtual hierarchy node; root is implicit and cannot be renamed/deleted.
- **Document**: a `.md` object with stable ID, current content and revision.
- **Version**: immutable snapshot produced by policy or protected operations.
- **Revision**: monotonically increasing optimistic-concurrency token.
- **Local Draft**: browser-only emergency copy keyed by document and revision.
- **Trash**: reversible soft-deleted subtree/document state.
- **Job**: durable database-backed background operation.
- **Raw-preserved block**: unsupported/unsafe syntax retained verbatim and edited as source.

## 5. Product invariants

1. No user action may silently lose or overwrite Markdown.
2. Every tenant-scoped query includes workspace ownership enforcement.
3. Tree mutations are cycle-safe and atomic at their logical boundary.
4. A failed local/remote save exposes whether content is safe and an actionable recovery path.
5. Editor/render capability is declared in one Markdown Capability Registry and verified by shared fixtures.
6. Security floors are code policy, not user-disableable preferences.
7. Long work is asynchronous, resumable/idempotent where defined, observable, and does not lock the editor UI.
8. The source of truth for official content is PostgreSQL; local drafts and temporary files never masquerade as committed data.

## 6. Visual source of truth

`assets/ui-reference.png` fixes the intended visual direction: warm off-white canvas, restrained blue accent, softly bordered floating panels, spatial separation, paper-like editor surface, compact iconography, strong but calm hierarchy. It does not override scope, security, behavior, accessibility or responsive requirements in this suite.
