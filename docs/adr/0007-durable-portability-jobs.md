# ADR 0007 — Durable import/export jobs and immutable export manifests

## Status

Accepted for Phase 6 on 2026-08-13.

## Context

Import and export cross HTTP, PostgreSQL and private temporary storage. They must survive worker
restart, prevent cross-workspace ID access, avoid duplicate terminal effects and produce one
logical export snapshot even while documents are being edited. V1 explicitly excludes attachment
storage; portability covers raw Markdown documents and visible folder hierarchy only.

## Decision

- Every execution is a PostgreSQL `background_jobs` state machine with a lease, monotonic
  checkpoint and durable `job_items`. An expired lease resets only a non-terminal running item;
  each import mutation and its terminal item result commit in the same serializable transaction.
- A retry is a child import job containing failed source keys only. Completed descendant keys are
  excluded, so repeating Retry Failed cannot duplicate a recovered item.
- Upload bytes use server-generated private paths. Preview verifies hashes and builds an expiring
  plan bound to owner, workspace, target and manifest. Execute revalidates all bindings. Archive
  paths reject traversal, absolute/backslash paths, links, encryption, duplicates, invalid UTF-8,
  expansion limits and unsafe compression ratios.
- Keep Both is the default collision strategy. Skip performs no document write. Replace first
  stores an `IMPORT_REPLACE` protected version and then increments the current revision.
- Export creation runs in a PostgreSQL repeatable-read transaction and stores an immutable
  manifest row per document, including exact raw Markdown and source revision. The worker archives
  only this snapshot; it never rereads live documents.
- Download grants are HMAC-signed and bind job, owner, workspace and expiry. Download and worker
  execution recheck current ownership/account status. ZIPs contain visible paths and Markdown only;
  any cross-platform filename mappings are reported without changing database names.
- Expired database-backed temp resources and old unreferenced server-named directories are removed
  in bounded maintenance sweeps. Containment checks precede every recursive removal.

## Consequences

Immutable manifests temporarily duplicate Markdown in PostgreSQL until job retention removes the
job. This storage cost buys deterministic concurrent export semantics and restart safety. Import
throughput is intentionally one bounded item transaction per checkpoint; later batching may be
benchmarked without changing the state-machine contract.

## Verification

Unit tests cover archive safety and portable filenames. Real PostgreSQL API/worker integration
tests cover bound previews, traversal, tenancy, idempotency, protected Replace, partial results,
retry lineage, cancellation, expired lease recovery, immutable snapshots, token authorization and
temp cleanup. Browser acceptance covers modal-close continuity, editor preservation, progress,
conflict controls and download.
