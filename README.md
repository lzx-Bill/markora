# Markora

Markora is a self-hostable, multi-user Markdown knowledge workspace. This repository is implementing
the frozen V1 specification in [`markora-spec`](./markora-spec/README.md).

## Current status

V1 release-candidate hardening is in progress. Identity/isolation, content, safe editing and local
recovery, versions/Trash, hybrid English/CJK search, durable import/export jobs, personal settings
and privacy-preserving administration are implemented with real PostgreSQL acceptance coverage.

## Repository map

```text
apps/       Web, API and Worker processes
packages/   Shared contracts, domain policy, Markdown registry, UI tokens and config
database/   Prisma schema, forward-only migrations and real-PostgreSQL tests
infra/      Development and deployment infrastructure
docs/       ADRs and operating/development documentation
markora-spec/ Frozen V1 source of truth
```

See [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) for setup and verification commands.
Production installation, backup/restore and upgrades are documented in
[`docs/OPERATIONS.md`](./docs/OPERATIONS.md); release gates are in
[`docs/RELEASE.md`](./docs/RELEASE.md).
