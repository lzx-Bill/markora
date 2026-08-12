# ADR 0003 — Content hierarchy baseline

## Status

Accepted for Phase 2 on 2026-08-12.

## Decisions

- Folder and document identity is a UUID; paths and breadcrumbs are derived presentation values.
- The root is implicit (`parent_id` / `folder_id` is null). Partial expression indexes treat null as
  one root namespace and enforce active normalized sibling uniqueness.
- Current parent relations use composite foreign keys with `workspace_id`, so the database rejects
  cross-workspace hierarchy links even if application scoping regresses.
- Trashing a folder changes only the selected root. Reachability-aware repositories hide its active
  descendants and documents without a workspace-size transaction.
- Metadata mutations require `expectedUpdatedAt`; content revision remains unchanged by open,
  rename, move, or mode selection.
- Depth defaults to 32, names to 255 Unicode code points, and Markdown to 5 MiB. These are typed
  startup limits.

## Verification

Real-PostgreSQL tests cover normalized collisions, cycle rollback, stable deep links, no-write open,
subtree hiding, itemized bulk results, API IDOR, database tenant foreign keys, and a 10,000-node tree
with a provisional local response budget below three seconds.
