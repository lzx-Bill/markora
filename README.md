# Markora

Markora is a self-hostable, multi-user Markdown knowledge workspace. This repository is implementing
the frozen V1 specification in [`markora-spec`](./markora-spec/README.md).

## Current status

Phase 3 editor vertical slice: sanitized GFM/math/Mermaid rendering, Source/WYSIWYG/desktop Split,
raw-block preservation, revision-guarded idempotent saves, protected conflict overwrite, versioned
IndexedDB drafts, offline continuation and Review/Restore/Discard recovery. Phase 1 identity and
Phase 2 workspace/content isolation remain enforced across every content route.

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
