<p align="center">
  <img src="apps/web/public/favicon.svg" width="88" height="88" alt="Markora logo">
</p>

<h1 align="center">Markora</h1>

<p align="center">
  <strong>Your Markdown. Your infrastructure. No compromises.</strong>
</p>

<p align="center">
  A self-hosted knowledge workspace that combines a polished visual editor with canonical Markdown,
  durable recovery, fast CJK search, and production-grade operations.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-makes-markora-different">Why Markora</a> ·
  <a href="docs/OPERATIONS.md">Operations</a> ·
  <a href="docs/DEVELOPMENT.md">Development</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-315CF5?style=flat-square">
  <img alt="Release: v0.1.0-rc.1" src="https://img.shields.io/badge/release-v0.1.0--rc.1-F59E0B?style=flat-square">
  <img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24-3C873A?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="PostgreSQL 18" src="https://img.shields.io/badge/PostgreSQL-18-4169E1?style=flat-square&logo=postgresql&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white">
</p>

<p align="center">
  <img src="docs/assets/markora-workspace.png" alt="Markora workspace showing the document tree, WYSIWYG editor and outline" width="100%">
</p>

> [!IMPORTANT]
> Markora is currently a **release candidate**. Its core data-safety and operational gates are
> implemented and tested, but deployment contracts may still evolve before the stable V1 release.

## Markdown should never become an exit format

Many editors treat Markdown as an import/export checkbox. Markora treats it as the canonical content
representation. PostgreSQL provides transactional durability, while every document remains real,
portable Markdown that can be downloaded exactly or exported as a clean folder tree.

Write visually when you want flow. Drop into Source when syntax matters. Use Split when you need both.
Raw HTML, frontmatter, fenced code, and unknown directives are protected from accidental rewriting
while the visual editor is open.

No proprietary document model. No external search cluster. No silent last-write-wins.

## What makes Markora different

| | |
| --- | --- |
| **Three editors, one document**<br>Switch between WYSIWYG, Source, and desktop Split without creating parallel representations of your content. | **Recovery is a product feature**<br>Revision-guarded saves, IndexedDB emergency drafts, immutable versions, Trash, and restore snapshots make failure recoverable by design. |
| **English and CJK search, built in**<br>Weighted PostgreSQL full-text search and `pg_trgm` substring indexes deliver relevant English, Chinese, and Japanese results without Elasticsearch. | **Portable by construction**<br>Download exact raw Markdown or export selections, folders, and entire workspaces as hierarchy-preserving ZIP archives. |
| **Background work that survives restarts**<br>Imports, exports, and permanent deletion use leased, checkpointed, idempotent jobs with bounded batches and safe retry. | **Self-hosting without guesswork**<br>Pinned container images, forward-only migrations, readiness checks, structured logs, audit trails, backup scripts, and a tested restore runbook are part of the repository. |

## Feature highlights

- **Focused knowledge workspace** — nested folders, stable document URLs, bulk operations, outline navigation, command palette, Quick Open, and keyboard-first search.
- **Safe Markdown editing** — GFM, task lists, tables, math, Mermaid, syntax highlighting, sanitization, large-document safeguards, and exact raw source downloads.
- **Conflict-proof saves** — every save carries a base revision and mutation ID; stale writes return a conflict instead of overwriting server content.
- **Offline draft protection** — the open document remains editable during connection loss, and divergent local drafts offer Review, Restore, or Discard after reload.
- **Version and Trash recovery** — preview and diff immutable versions, restore without rewriting history, and recover moved or renamed subtrees without silent collisions.
- **Defensive import/export** — mandatory import preview plus traversal, symlink, compression-ratio, encoding, file-count, depth, and size protections.
- **Multi-user isolation** — workspace scope is derived from the authenticated principal; object IDs alone never authorize access.
- **Administration with boundaries** — user/session management, staged system settings, durable jobs, health status, and privacy-preserving audit events.

## Architecture

Markora is a modular monolith with independently runnable Web, API, and Worker processes. PostgreSQL
is the only durable dependency; Redis and external search services are deliberately unnecessary.

```mermaid
flowchart LR
  Browser["Browser"] --> Proxy["Caddy / TLS"]
  Proxy --> Web["React + Vite"]
  Proxy --> API["NestJS API"]
  API --> DB[("PostgreSQL 18")]
  Worker["Durable Worker"] --> DB
  DB --> Worker
  API -. "leased jobs" .-> Worker
```

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Web | React 19, TypeScript, Vite, CodeMirror, Milkdown | Workspace UI, editing, local draft recovery |
| API | NestJS, Zod contracts, Prisma, parameterized SQL | Authentication, content, search, versions, administration |
| Worker | NestJS, PostgreSQL leases | Import/export, deletion, retention, orphan cleanup |
| Data | PostgreSQL 18, `pg_trgm` | Canonical Markdown, transactional indexes, jobs, audit |
| Edge | Caddy, Docker Compose | TLS, routing, security headers, health-aware startup |

The frozen V1 specification, API contract, acceptance matrix, and architectural decisions are kept in
[`markora-spec`](markora-spec/README.md) and [`docs/adr`](docs/adr). The implementation does not get to
silently redefine the product.

## Quick start

### Prerequisites

- Node.js `24.11.1`
- pnpm `10.28.2`
- Docker with Compose v2

### Run locally

```bash
git clone https://github.com/lzx-Bill/markora.git
cd markora
cp .env.example .env
```

Replace `SESSION_SECRET` and `BOOTSTRAP_ADMIN_PASSWORD` in `.env`, then start PostgreSQL and Markora:

```bash
docker compose -f infra/docker/compose.postgres.yaml up -d --wait
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm bootstrap:admin
pnpm dev
```

Open `http://localhost:27183`. The bootstrap command works only while the users table is empty and
forces a password change on first login.

For a production deployment with private PostgreSQL networking, automatic TLS, health checks,
backup/restore, and upgrade guidance, follow the [operations guide](docs/OPERATIONS.md).

## Proof, not promises

The release benchmark executes real application paths against PostgreSQL rather than mocked storage.
This reference run used PostgreSQL 18.4 on an Intel Core i9-13900HX; results vary by hardware.

| Release workload | Result | Budget |
| --- | ---: | ---: |
| 10,000-folder tree, p95 | **61 ms** | 500 ms |
| 1 MiB document open, p95 | **23 ms** | 2,000 ms |
| 20-document concurrent save batch, p95 | **63 ms** | 1,000 ms |
| 10,001-document CJK search, p95 | **36 ms** | 500 ms |
| 1,000-job list, p95 | **4 ms** | 200 ms |
| 300-document import | **13.5 s** | 30 s |
| 300-document export | **105 ms** | 10 s |

Reproduce the gates on a disposable `markora_test` database:

```bash
pnpm verify
DATABASE_URL=postgresql://markora:markora@localhost:27185/markora_test?schema=public pnpm test:integration
DATABASE_URL=postgresql://markora:markora@localhost:27185/markora_test?schema=public pnpm benchmark:release
```

See [`docs/RELEASE.md`](docs/RELEASE.md) for the complete release protocol.

## Security model

Markora uses Argon2id password hashing, server-managed revocable sessions, login throttling, CSRF
protection, strict runtime validation, parameterized SQL, sanitized rendering, private temporary
workspaces, expiring download grants, and a least-privilege container runtime. Production PostgreSQL
has no host port, and logs/audit events deliberately exclude Markdown bodies and secrets.

Please report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).

## Development

```bash
pnpm install --frozen-lockfile
pnpm verify
```

The monorepo uses pnpm workspaces:

```text
apps/         Web, API, and Worker processes
packages/     Contracts, domain policy, Markdown, UI, portability, configuration
database/     Prisma schema, forward-only migrations, real-PostgreSQL tests
infra/        Docker, reverse proxy, backup and restore assets
docs/         Architecture decisions and operating guides
markora-spec/ Frozen V1 product and acceptance specification
```

Read [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for setup details and
[`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request.

## License

Markora is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified
version as a network service, the AGPL requires you to offer its corresponding source code to users
of that service.
