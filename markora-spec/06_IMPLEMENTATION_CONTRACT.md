# 06 — Implementation Contract

This file defines cross-layer rules. A feature is incomplete if UI, API, persistence and tests do not agree.

## IC-01 — Workspace isolation

- Every workspace resource load/mutation MUST scope by authenticated workspace in the query itself.
- Cross-workspace IDs MUST return 404-like behavior and MUST NOT disclose existence.
- Background jobs MUST carry/revalidate owner scope. Temporary download tokens MUST be scope-bound and expiring.
- Tests MUST cover each resource family with User A/User B fixtures.

## IC-02 — Markdown preservation

- The exact server string remains unchanged unless the user or an explicit operation changes content.
- WYSIWYG serialization may normalize supported syntax only after editing.
- Raw-preserved blocks MUST round-trip byte-identically.
- Renderer output is never stored as canonical Markdown.
- Shared capability fixtures MUST execute through WYSIWYG import/export, Source, renderer and sanitizer.

## IC-03 — Safe saves and local drafts

- Every save supplies `baseRevision`; server update is conditional and atomic.
- 409 stops auto-save and opens conflict UX. No automatic retry with a newer revision.
- Client writes emergency draft before/while unsynced and clears it only after matching server acknowledgement.
- Closing/navigation warning appears only while a local unsynced draft exists.

## IC-04 — Naming and hierarchy

- One shared naming policy/library is used server-side; client mirrors for early feedback but server is authoritative.
- Database uniqueness backs the policy; application catches and maps races to `NAME_CONFLICT`.
- Move validates ownership, active state, target, depth, collision and folder-cycle inside the transaction.
- Paths are presentation values. Stable routes and relationships use IDs.

## IC-05 — Version and restore

- Versions are immutable.
- Protected operations snapshot pre-change state in the same transaction.
- Restore requires current base revision and creates a new current revision/version event.
- History preview never mutates document or local draft.

## IC-06 — Trash and permanent delete

- Trash is reversible and preserves enough origin metadata for restore.
- Trashed ancestors hide descendants without ambiguous duplicate trash roots.
- Permanent delete transitions to `DELETING` before batches. Requests are idempotent.
- UI wording states app-level irreversibility and backup-retention caveat where appropriate.

## IC-07 — Import

- No import executes without an unexpired preview plan.
- Preview/execute both enforce archive, file, size, depth, encoding, name and ownership constraints.
- Per-item transaction + deterministic source key prevents duplicate effects.
- Replace snapshots old state. Keep Both uses shared name generator. Skip has no write.
- Job outcome MUST preserve itemized status and support retry-failed without rerunning successes.
- Non-`.md` files are ignored and aggregate-reported.

## IC-08 — Export

- Export manifest captures a consistent logical snapshot before archive generation.
- Archive path derives only from safe normalized display hierarchy, never IDs.
- File bytes are raw Markdown from the captured revisions.
- Name adjustments are mapped in a user report but do not mutate data.
- Temporary output is private, expiring and deleted by terminal/orphan cleanup.

## IC-09 — Jobs

- Job acceptance and durable enqueue cannot split; use same-DB outbox/job insert transaction.
- Claim uses lease/locking; handlers are idempotent at checkpoint/item boundary.
- Progress is monotonic; terminal states do not regress.
- Retry/cancel is state-gated. Worker restart has tested recovery behavior.

## IC-10 — Authentication and admin privacy

- No public signup/email reset. Bootstrap is one-time and disabled after initialization.
- Disabled users cannot start/continue sessions; sensitive account changes revoke/rotate sessions.
- Admin content access is absent by design: no admin endpoint/repository returns Markdown, document names/paths/snippets, or export tokens for other users.
- Last active admin cannot demote/disable self if it would leave no admin.

## IC-11 — Rendering and external content

- Sanitizer is mandatory and deny-by-default for tags/attributes/protocols.
- Scripts, event handlers, unsafe URL schemes and local file URLs are blocked regardless of settings.
- Mermaid execution is constrained; generated SVG/HTML is sanitized.
- External images obey CSP/system/user policy and do not leak referrer where configurable.

## IC-12 — Error and observability

- Every API error has stable code, safe message and request ID.
- UI maps known error codes to recovery actions and preserves user input.
- Logs/audit/jobs exclude Markdown bodies, credentials, tokens, raw archives and secret config.
- Request/job IDs connect UI support details to logs without exposing internals.

## IC-13 — Configuration

- Startup rejects missing/invalid required configuration.
- User preference keys and admin config keys are typed/versioned.
- Admin patch validates as a whole, uses config version and writes audit on success/failure.
- Security floors are compile/deployment policy, not mutable database settings.

## IC-14 — UI state isolation

- Tree/list/search refresh affects only that region.
- Import/export/jobs never close or replace the current editor.
- Deep links remain stable through rename/move.
- Optimistic UI has a deterministic rollback and communicates failure.

## IC-15 — Database evolution

- Migrations are ordered, repeatably testable from empty and previous release state.
- Destructive schema changes require expand/migrate/contract and restore evidence.
- App readiness fails on incompatible migration version; worker does not process with incompatible schema.

## IC-16 — No speculative V1 features

Implementation MUST NOT expose Favorites, Share, attachments, tags, public registration, trusted HTML, collaborative editing, full offline mode, Redis or external search engine. Internal extensibility is acceptable only when it does not expand UI/API, weaken contracts or delay acceptance.
