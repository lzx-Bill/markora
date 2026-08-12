# 10 — Open Questions and Tunable Defaults

No item here may weaken a Source-of-Truth invariant. Coding may proceed using the provisional default; record the final value in configuration documentation.

| ID | Topic | Provisional V1 default | Blocking? |
|---|---|---|---|
| OQ-001 | Max Markdown size | 5 MiB per document | No |
| OQ-002 | Large-document mode threshold | 1 MiB or 50k lines, whichever first | No |
| OQ-003 | Import batch/file/depth limits | 2 GiB archive, 10k files, depth 32; production may lower | No |
| OQ-004 | Auto-save debounce | 1.5 seconds after last edit; flush on safe navigation | No |
| OQ-005 | Routine version snapshot cadence | At most one auto snapshot per 10 minutes of active changes plus protected operations | No |
| OQ-006 | Trash retention | 30 days before eligible cleanup | No |
| OQ-007 | Version retention | Keep protected/manual versions; configurable routine retention, default 90 days | No |
| OQ-008 | Session lifetime | 30 days absolute; rotate on sensitive changes | No |
| OQ-009 | Product name | `Markora` working name; display name is deployment config | No |
| OQ-010 | CJK tokenizer strategy | Benchmark PostgreSQL-supported strategies/extension policy before selection | Yes for search release gate only |

Decision process: create an ADR with evidence, impact, migration effect and acceptance-test change. Product scope changes require updating `00_SOURCE_OF_TRUTH.md`, the relevant contract, and acceptance rows in one change.
