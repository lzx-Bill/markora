# ADR 0006 — PostgreSQL hybrid search and CJK strategy

## Status

Accepted for Phase 5 on 2026-08-13. This resolves OQ-010.

## Context and evidence

Markora V1 must search English and CJK document names, paths and Markdown while preserving
workspace isolation, folder ancestry scopes and the existing self-hosted PostgreSQL deployment.
PostgreSQL `simple` full-text search does not tokenize Chinese substrings reliably. A repeatable
benchmark in `database/benchmarks/search-benchmark.ts` compared three strategies on 10,000
documents, seven English/Chinese/Japanese cases and 40 measured iterations per case:

| Strategy | Hit@5 | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| `simple` FTS | 0.4286 | 0.764 ms | 1.242 ms | 2.320 ms |
| trigram substring | 1.0000 | 0.913 ms | 1.345 ms | 1.801 ms |
| hybrid | 1.0000 | 0.986 ms | 1.330 ms | 1.700 ms |

Environment: PostgreSQL 18.4 x86_64 Linux. The recorded Phase 5 budget is p95 below 500 ms and
Hit@5 1.0 for the representative cases. Results are machine/environment dependent; the script is
the reproducible authority and the acceptance artifact records this run.

## Decision

- Use PostgreSQL only: weighted `simple` `tsvector` for token/rank signals plus `pg_trgm`-indexed
  substring matching for CJK and partial-term recall. Do not introduce an external search service.
- Require `pg_trgm` in the Phase 5 migration. Generated stored search text/vector columns make
  create, rename and revision-guarded saves update the index in the same database transaction.
- Use exact, prefix, path substring, text substring, FTS rank and trigram similarity as ordering
  signals. Similarity alone is not a recall predicate because a low threshold produced irrelevant
  pagination results during real integration testing.
- Maintain separate generated columns with and without fenced/inline code. Code is excluded by
  default and included only when requested.
- Build folder paths and ancestry inside a workspace-scoped recursive CTE. Search and Quick Open
  include only reachable `ACTIVE` resources, and scoped folder IDs are ownership-checked first.
- Use an opaque offset cursor for V1 progressive pagination. Results have a deterministic ID
  tiebreaker; a future relevance model may replace the cursor format without exposing internals.

## Consequences

The deployment must allow the trusted PostgreSQL `pg_trgm` extension. Search adds four stored
generated columns and five GIN indexes to `documents`, increasing write and storage cost in return
for transactional freshness and strong CJK substring recall. A future tokenizer extension requires
a new benchmark and ADR; it is not a release prerequisite for V1.

## Verification

Real PostgreSQL tests cover content/name/path matches, direct-folder and subtree scopes, code-block
policy, index updates, pagination, trashed content, foreign-workspace isolation and a representative
10k CJK latency check. Chromium acceptance covers Search, Quick Open and Command Palette keyboard
flows, focus containment/return, stable document routing and route-valid command visibility.
