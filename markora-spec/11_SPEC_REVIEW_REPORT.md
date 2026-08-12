# 11 — Specification Review Report

Review date: `2026-08-12`  
Result: **PASS — ready for phased implementation**

## 1. Review performed

- Checked scope against the final design review and prototype.
- Checked Product → Domain → Architecture → API → UX → Implementation Contract → Acceptance traceability.
- Checked high-risk paths: workspace isolation, stale saves, Markdown round-trip, raw HTML, local draft, version restore, trash/delete, ZIP import, partial success, consistent export, job restart, admin privacy, migration/backup.
- Checked that architecture decisions use PostgreSQL-only durability, no Redis, Web/API ports 27183/27184, modular monolith and database-backed worker.
- Checked excluded features are not accidentally required by the prototype.

## 2. Conflicts resolved in this suite

| Earlier ambiguity/conflict | Frozen resolution |
|---|---|
| WYSIWYG “lossless” vs serializer normalization | Semantic preservation for edited supported syntax; exact no-edit/raw-block preservation; Source for byte control |
| `.md` vs `.markdown` | `.md` only |
| file name, title and H1 | document name only; H1 is content |
| full import rollback vs partial report | per-item partial success + retry-failed; no V1 whole-job rollback promise |
| permanent delete transaction vs large subtree | DELETING state + short restart-safe batches |
| PostgreSQL-only vs ZIP filesystem needs | ephemeral per-job temp workspace, never durable content storage |
| permanent deletion vs backups | unavailable in application; backup copies expire by backup retention |
| offline safety vs offline-first scope | emergency draft for current open document only |
| safe vs trusted Markdown | sanitizer always on; no Trusted mode |
| prototype Favorites/Share vs frozen scope | retain visual direction; hide both capabilities in V1 |
| user/auth without registration/email | admin-created users, one-time bootstrap admin, admin reset |

## 3. Coverage summary

- Source-of-truth decisions: 20.
- Cross-layer implementation contracts: 16.
- Acceptance requirements: 71 across auth, isolation, content, editor, recovery, versions, trash, import/export, search, settings/admin, jobs, security, UI, operations and performance.
- Core deliverables: 13 Markdown files plus the approved UI reference.

## 4. Residual risks and gates

1. CJK search strategy remains an evidence-driven implementation decision; it blocks only the search release gate, not earlier phases.
2. Operational limit numbers are provisional and must be benchmarked/configured without weakening safety ceilings.
3. WYSIWYG compatibility is the highest data-integrity risk; shared fixtures and no-edit/raw-preserved oracles are mandatory before import Replace ships.
4. Export snapshot implementation must be proven under concurrent saves.
5. Worker lease/checkpoint behavior must be killed/restarted in tests, not only unit-tested.

These risks have owners in the task graph, explicit acceptance rows and verification procedures. None requires expanding V1 scope.

## 5. Final implementation instruction

Start with `README.md`, follow `08_TASK_GRAPH.md`, and treat `00_SOURCE_OF_TRUTH.md`, `06_IMPLEMENTATION_CONTRACT.md`, and all P0/P1 acceptance rows as non-negotiable. When an implementation detail is genuinely absent, record an ADR/open question; do not invent a user-facing feature or weaken a safety invariant.
