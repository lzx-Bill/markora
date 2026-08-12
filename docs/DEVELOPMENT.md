# Markora development

## Prerequisites

- Node.js `24.11.1`
- pnpm `10.28.2`
- Docker with Compose v2

## Install

```powershell
Copy-Item .env.example .env
pnpm install --frozen-lockfile
```

Replace the example session secret before using any shared or production-like environment.

## PostgreSQL and migrations

```powershell
docker compose -f infra/docker/compose.postgres.yaml up -d --wait
$env:DATABASE_URL = "postgresql://markora:markora@localhost:27185/markora?schema=public"
pnpm db:migrate
```

The development Compose file binds PostgreSQL only to loopback. Production uses
`infra/docker/compose.yaml`: Caddy is the only host-facing service and PostgreSQL has no published
port. See `docs/OPERATIONS.md`.

## Run

Set the values from `.env.example` in the current shell or load them with your preferred secret-safe
development environment, then run:

```powershell
pnpm dev
```

The Web process uses port `27183`; the API uses `27184`; the Worker has no public port.

## One-time bootstrap admin

Fill the `BOOTSTRAP_ADMIN_*` values in `.env`, then run:

```powershell
pnpm bootstrap:admin
```

The command succeeds only while the users table is empty. It creates exactly one admin and one
workspace, stores only an Argon2id password hash, and forces a password change on first login.

## Integration database

Fresh development Compose volumes create `markora_test` automatically. Migrate and test it without
touching local development data:

```powershell
$env:DATABASE_URL = "postgresql://markora:markora@localhost:27185/markora_test?schema=public"
pnpm db:migrate
pnpm test:integration
```

## Verify

```powershell
pnpm verify
$env:DATABASE_URL = "postgresql://markora:markora@localhost:27185/markora_test?schema=public"
pnpm test:integration
```

`pnpm verify` covers formatting/lint, type checking, unit/component tests, OpenAPI drift, Prisma
schema validation and production builds. Integration tests always target real PostgreSQL.

## Content and editor limits

`WORKSPACE_MAX_DEPTH`, `WORKSPACE_NAME_MAX_CODE_POINTS`, and `DOCUMENT_MAX_BYTES` are typed startup
configuration. `DOCUMENT_LARGE_BYTES`, `DOCUMENT_LARGE_LINES`, and
`VERSION_SNAPSHOT_INTERVAL_MINUTES` control the Phase 3 safety mode and routine immutable version
snapshots. `VERSION_RETENTION_DAYS` prunes only routine `AUTO_SAVE` snapshots; protected
Replace/conflict/restore snapshots remain available. `TRASH_RETENTION_DAYS` controls when logical
Trash roots become eligible for automatic permanent deletion. Folder and document mutations use
stable IDs and are always scoped from the
authenticated principal; callers never provide a workspace ID. The Web route
`/documents/<document-id>` therefore survives folder and ancestor rename/move operations.

Source uses CodeMirror; WYSIWYG uses Milkdown Crepe; desktop Split renders a sanitized unified
pipeline. Raw HTML, frontmatter and unknown directives are masked while the visual editor is open
and restored byte-for-byte. External images are blocked rather than fetched. Saves include
`baseRevision` and a unique mutation ID; a stale revision returns `409 REVISION_CONFLICT` and never
overwrites the server copy.

Unsynced Markdown is written first to the versioned `markora-emergency-drafts` IndexedDB database.
Only a matching server acknowledgement removes it. Reloading with a divergent draft offers
Review/Restore/Discard; already-open documents remain editable offline, while tree/search and other
documents are explicitly not advertised as available. Single documents use the authenticated raw
Markdown endpoint; selection, folder and workspace exports use a durable server-side snapshot job.

## Versions, Trash and deletion worker

Version history is available from the document header. Selecting a snapshot only previews and
diffs it; restore is disabled while an unsynced local draft exists. Restore requires the current
revision and creates a safety snapshot before changing current content.

Trash is available at `/trash`. Restore defaults to the captured original location and never
overwrites an active sibling. Choose an active target when the original parent no longer exists,
or enable Keep Both to allocate a deterministic sibling name. Permanent deletion immediately makes
the root unavailable and queues a durable job. `DELETE_BATCH_SIZE`, `JOB_LEASE_SECONDS`, and
`WORKER_POLL_MS` bound and schedule processing; expired leases are safe to reclaim after restart.
App-level deletion does not remove existing database backups; production must apply the Phase 8
backup retention and restore-runbook controls in `docs/OPERATIONS.md`.

## Search benchmark

Phase 5 uses PostgreSQL `simple` full-text rank plus `pg_trgm` substring matching so English and
CJK content share one transactionally updated provider. The migration installs the trusted
extension and generated document indexes. Reproduce the OQ-010 decision only against the disposable
integration database:

```powershell
$env:DATABASE_URL = "postgresql://markora:markora@localhost:27185/markora_test?schema=public"
pnpm exec tsx database/benchmarks/search-benchmark.ts
```

The benchmark creates and removes an unlogged 10,000-document table. The accepted decision and
recorded result are in `docs/adr/0006-postgresql-hybrid-search.md` and
`artifacts/acceptance/SRCH-003/result.json`. Runtime shortcuts are Ctrl/Cmd+P for Quick Open,
Ctrl/Cmd+Shift+F for Search and Ctrl/Cmd+K for Command Palette.

## Import, export and portability worker

Use Import Markdown from the workspace toolbar, empty state, drag-and-drop or Command Palette.
Every upload requires a no-write preview before execution. Keep Both is the default; Skip performs
no document write and Replace creates a protected version. Closing the modal does not cancel the
job or close the editor. The background tray exposes monotonic progress, valid-state cancel and
failed-item-only retry.

Single-document download returns exact stored Markdown. Selection, folder and workspace exports
capture an immutable database snapshot and produce a private ZIP. The returned download grant is
bound to the current user/workspace/job and expires after `EXPORT_DOWNLOAD_TTL_MINUTES`.

`IMPORT_UPLOAD_MAX_BYTES`, `IMPORT_MAX_FILES`, `IMPORT_MAX_TOTAL_BYTES`,
`IMPORT_MAX_COMPRESSION_RATIO`, `IMPORT_UPLOAD_TTL_MINUTES`, `IMPORT_PLAN_TTL_MINUTES`,
`EXPORT_PATH_MAX_BYTES`, `JOB_ITEM_BATCH_SIZE` and `TEMP_ORPHAN_AGE_MINUTES` control safety and
retention. `TEMP_ROOT/imports` and `TEMP_ROOT/exports` must be private, writable only by the Markora
process user and excluded from backups. The Worker removes expired rows/artifacts and old
unreferenced server-named directories in bounded sweeps.
Set `MARKORA_ROOT` when processes are launched from different working directories; relative
`TEMP_ROOT` values otherwise resolve from the package-manager launch root (`INIT_CWD`).
