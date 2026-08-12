# ADR 0001 — Phase 0 toolchain

Status: Accepted
Date: 2026-08-12

## Decision

- Node.js 24 LTS and pnpm 10 are the pinned JavaScript toolchain.
- The repository is a pnpm workspace without an additional task orchestrator.
- TypeScript, Zod runtime schemas, Biome, Vitest, Vite, NestJS and Prisma form the baseline.
- PostgreSQL 18 is pinned by multi-platform image digest for development verification.
- Shared packages expose source declarations for workspace type-checking and emit ESM builds.

## Rationale

The architecture specification requires a pinned supported Node LTS, a modular monolith, one
runtime-schema boundary, real PostgreSQL integration tests and reproducible builds. A plain pnpm
workspace meets those needs without adding an orchestration layer before the repository needs one.

## Consequences

- Toolchain upgrades require an ADR update, lockfile refresh and full verification.
- Database behavior is not accepted from SQLite or repository mocks.
- Phase-owned domain tables are added only when their vertical slice starts.
