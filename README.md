# Markora

Markora is a self-hostable, multi-user Markdown knowledge workspace. This repository is implementing
the frozen V1 specification in [`markora-spec`](./markora-spec/README.md).

## Current status

Phase 2 folder/document vertical slice: workspace-scoped hierarchy and Markdown records, stable-ID
document routes, normalized naming constraints, create/open/rename/move/trash and itemized bulk
operations, optimistic UI rollback, and real PostgreSQL isolation/performance tests. Phase 1
identity/session protections remain enforced across every content route.

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
