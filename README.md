# Markora

Markora is a self-hostable, multi-user Markdown knowledge workspace. This repository is implementing
the frozen V1 specification in [`markora-spec`](./markora-spec/README.md).

## Current status

Phase 1 identity and isolation: one-time bootstrap admin, Argon2id credentials, opaque cookie
sessions, authentication/CSRF guards, login throttling/audit, account session controls, and an
authenticated application shell backed by real PostgreSQL integration tests.

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
