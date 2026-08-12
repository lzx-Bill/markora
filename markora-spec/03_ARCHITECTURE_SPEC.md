# 03 — Architecture Specification

## 1. Architecture style

V1 is a modular monolith with separate Web, API and Worker processes sharing one codebase/domain packages and PostgreSQL. The worker is not a microservice boundary. Modules communicate through application services and typed domain events, not cross-module table access.

## 2. Technology baseline

- Web: React + TypeScript + Vite, React Router, TanStack Query for server state, Tailwind CSS backed by CSS design tokens, and Radix-style accessible headless primitives. Local editor state stays local; do not mirror server resources into a second global store.
- Editor: Milkdown/ProseMirror for WYSIWYG, CodeMirror for Source, shared Markdown capability adapter.
- Markdown pipeline: unified/remark/rehype family, GFM, Mermaid, KaTeX-compatible math, explicit sanitizer schema.
- API/Worker: NestJS + TypeScript, REST JSON, OpenAPI generated/checked from runtime contracts; DTO validation uses one shared runtime-schema approach rather than handwritten duplicate types.
- Persistence: PostgreSQL with Prisma as the baseline migration/data-access tool behind repositories; targeted parameterized SQL is allowed for recursive CTE, search, lease and bulk operations Prisma cannot express safely.
- Test: unit + integration against real PostgreSQL + browser E2E + visual regression + security fixtures.
- Runtime: Node.js current supported LTS chosen at implementation kickoff; exact dependencies pinned by lockfile and container digest.

Do not substitute a different framework without an ADR and corresponding spec changes.

## 3. Module boundaries

```text
apps/
  web/
  api/
  worker/
packages/
  contracts/          # DTO schemas, error codes, generated client boundary
  domain/             # pure types, policies, state machines
  markdown/           # capability registry, parse/render/sanitize fixtures
  ui/                 # tokens and reusable accessible components
  config/             # typed config definitions
database/
  migrations/
  seeds/
tests/
  fixtures/markdown/
  integration/
  e2e/
  visual/
infra/
  docker/
  reverse-proxy/
  scripts/
docs/
```

API feature modules: Auth, Users, Sessions, Workspaces, Folders, Documents, Versions, Search, ImportExport, Jobs, Preferences, AdminConfig, Audit, Health. Each owns controller → application service → domain policy → repository adapter. Controllers contain no business transaction logic.

## 4. Runtime topology

- `web` listens on internal host/container port **27183**.
- `api` listens on **27184**.
- reverse proxy owns public HTTP(S), serves/routes Web and `/api`, sets security headers and request size limits.
- `worker` has no public port and claims durable jobs from PostgreSQL.
- PostgreSQL is private to the application network; no production host exposure by default.
- No Redis in V1.

Local Docker Compose combines Web, API, Worker, PostgreSQL and reverse proxy, with profiles allowing developer-run Web/API outside containers. Online deployment uses the same images/config contract. Health checks distinguish liveness from readiness.

## 5. Request flow and authorization

1. Proxy attaches/propagates request ID and forwards authenticated cookie/header.
2. API validates session, status and CSRF policy where cookie auth applies.
3. Guard constructs principal (`user_id`, `workspace_id`, `role`, session).
4. Application service authorizes capability.
5. Repository scopes query by workspace; IDs alone never authorize.
6. Transaction commits domain change and audit/outbox metadata.
7. Response uses stable DTO/error envelope; logs exclude content/secrets.

## 6. Markdown architecture

Create one `MarkdownCapabilityRegistry` consumed by editor adapters, renderer, import validation and tests. Each construct is classified:

| Construct | Edit | Render | Preservation |
|---|---|---|---|
| headings, emphasis, lists, links, code, blockquote | structured | safe | semantic |
| GFM table/task/strike | structured | safe | semantic |
| fenced Mermaid | block/source | sandboxed/sanitized output | source fence retained |
| math | inline/block adapter | safe renderer | semantic/source fallback |
| URL image | structured/source | policy-controlled external load | URL retained |
| raw HTML | source/raw block | sanitized only | original source retained |
| unknown syntax | raw block | escaped/fallback | byte-preserved block |

Mermaid/math failure renders an isolated error block. WYSIWYG initialization failure offers Source mode. Sanitizer schema, link protocol policy and CSP are versioned fixtures.

## 7. Search architecture

Define `SearchProvider` but ship one PostgreSQL implementation. Index name/path/body plus scope ancestry. Result contract returns stable document ID, path, snippet, match locations where practical and rank. Run an English + CJK corpus benchmark before final tokenizer/index choice. Elasticsearch is not a V1 fallback.

## 8. Background jobs

Worker polls/claims with `FOR UPDATE SKIP LOCKED` or equivalent lease semantics. Jobs are bounded, checkpointed, idempotent and rate/concurrency limited by type. Types: IMPORT, EXPORT, PERMANENT_DELETE, VERSION_PRUNE, TRASH_CLEANUP, TEMP_CLEANUP, optional SEARCH_REINDEX.

Progress is `(completed,total,current_item,phase)` and may be polled; WebSocket/SSE is optional, not required. User can close dialogs without stopping jobs. Admin sees error codes/request IDs; user sees safe reasons.

## 9. Temporary workspace

ZIP input/output uses a per-job directory under an explicit temp root. Generate server-side names; never trust archive paths. Reject traversal, absolute paths and links. Extract with hard limits while counting compressed/uncompressed bytes. Permissions are private. Cleanup runs after terminal status and by orphan sweeper. Markdown durability remains PostgreSQL-only.

## 10. Security architecture

- Argon2id password hashing with recorded hardware calibration; high-entropy opaque server-managed sessions whose hashes/state live in PostgreSQL; rotation/revocation; login throttling.
- Secure, HttpOnly, SameSite cookies where same-origin; CSRF defense for mutating requests; TLS at proxy.
- Strict DTO validation, size/depth limits, parameterized SQL, output encoding.
- Sanitizer + CSP block scripts, unsafe schemes, local files and uncontrolled embedding.
- External images obey user preference and system allow/block policy, use no-referrer where supported, and show failure placeholders.
- ZIP bomb/path traversal/symlink defenses and export filename normalization report.
- Audit privileged/destructive/auth/export actions but never Markdown bodies, passwords, session tokens, raw archives or secrets.
- Secrets arrive through environment/secret files, are schema-validated at boot, never committed, and are redacted.

## 11. Observability

Structured JSON logs include timestamp, level, service, request/job ID, actor ID where safe, route/action, duration, result and error code. Metrics cover request latency/error, DB pool, save conflicts/failures, job queue/age/failures, import/export volume, auth failures and temp cleanup. Readiness checks API dependencies and migration compatibility; liveness checks process health. Audit is a product record, separate from logs.

## 12. Configuration

Precedence: code defaults < deployment config < environment/secret injection. All config is typed and boot-validated. Environment-specific values include public origin, DB URL, session keys, bootstrap mode, ports, limits, retention, logging and temp root. Security floors cannot be overridden by database settings.

## 13. Migration and deployment

Migrations are forward-only, transactional when PostgreSQL permits, and run once before new app readiness. Breaking schema changes use expand/migrate/contract across compatible releases. Deployment sequence: backup/restore confidence → migrate → start API/worker/web → readiness → route traffic. Rollback never blindly reverses a destructive migration.

V1 defines reproducible commands and container builds but deliberately does not prescribe CI/CD.
