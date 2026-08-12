# ADR 0009: Release runtime, save concurrency and performance budgets

## Status

Accepted for Markora V1 release candidate on 2026-08-13.

## Decision

- Ship one immutable application image with separate one-shot Migration, API, Web and Worker
  processes. Put PostgreSQL and application ports on an internal Compose network and expose only
  the pinned Caddy reverse proxy.
- Run application containers as UID 10001 with read-only roots, dropped capabilities and dedicated
  temporary mounts. Readiness requires the current migration marker and no unfinished migration.
- Serialize saves for the same document with a PostgreSQL transaction advisory lock. Retry only
  Prisma `P2034` serialization/deadlock failures with a bounded backoff; revision conflicts remain a
  normal `409` response and are never retried as writes.
- Gate the release on the checked-in benchmark: 10k folders plus 10k documents, 1 MiB open, 20
  concurrent versioned saves, English/CJK search, 1,000 jobs and real 300-document import/export.
  Current local budgets are 500 ms tree p95, 2 s open p95, 1 s save-batch p95, 500 ms search p95,
  200 ms job-list p95, 30 s import and 10 s export.

## Consequences

The migration process must complete before traffic starts, and operators must treat a failed
readiness check as a deployment stop. Same-document writes are deterministic while unrelated
documents remain concurrent. The benchmark is intentionally PostgreSQL-backed and destructive only
inside a database URL containing `markora_test`; budget changes require recorded evidence and a new
decision.
