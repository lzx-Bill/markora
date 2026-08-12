# Markora

Markora is a self-hostable, multi-user Markdown knowledge workspace. This repository is implementing
the frozen V1 specification in [`markora-spec`](./markora-spec/README.md).

## Current status

Phase 0 foundation: pnpm monorepo, typed configuration, API contracts, migration harness, process
entry points, design tokens and the accessible application shell.

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
