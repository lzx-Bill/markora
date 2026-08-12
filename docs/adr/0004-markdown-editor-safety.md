# ADR 0004 — Markdown editor and save safety

## Status

Accepted for Phase 3 on 2026-08-12.

## Decisions

- Markdown is canonical. CodeMirror edits it directly; Milkdown Crepe is an adapter and cannot
  silently normalize unknown/raw-preserved blocks.
- A shared unified renderer handles GFM and math, sanitizes raw HTML and unsafe protocols, blocks
  external image fetches, and hardens outbound links. Mermaid renders separately with strict
  security and sanitized SVG output.
- Raw HTML, frontmatter and unknown directives are replaced by deterministic sentinels while the
  visual editor runs. Missing sentinels fail closed into Source mode.
- Visual-editor initialization and per-block Mermaid/math failures preserve source and expose an
  explicit Source fallback. Documents above configured byte/line thresholds force Source mode.
- Content saves require a base revision and idempotency UUID. One accepted changed save increments
  exactly once; stale saves return a scoped conflict payload without mutation.
- Conflict overwrite first creates an immutable server snapshot. Routine saves snapshot on the
  configured interval; audit records contain hashes/metadata but never Markdown bodies.
- Unsynced content is persisted to a versioned IndexedDB draft before network acknowledgement and
  removed only when the acknowledged Markdown matches.

## Verification

Unit tests cover renderer hardening, raw preservation, failure fallback and draft acknowledgement.
Real-PostgreSQL integration tests cover idempotency, no-op saves, conflicts, immutable snapshots,
large-document capability and tenant isolation. Chromium evidence covers all three editor modes,
XSS non-execution, isolated block failures, offline editing, recovery review and conflict recovery.
