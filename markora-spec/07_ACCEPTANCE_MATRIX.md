# 07 — Acceptance Matrix

Priority: P0 blocks any release; P1 blocks V1 release; P2 is required unless explicitly deferred by recorded decision. Evidence codes: `U` unit, `I` integration with real PostgreSQL, `E` browser E2E, `V` visual/accessibility, `S` security, `O` operational drill.

| ID | Pri | Requirement / Given–When–Then acceptance | Evidence |
|---|---:|---|---|
| AUTH-001 | P0 | Fresh install with no users creates exactly one bootstrap admin through the documented one-time path; path is disabled afterward. | I,O |
| AUTH-002 | P0 | No public register or email forgot-password route/page exists. | I,E |
| AUTH-003 | P0 | Valid login creates secure session; invalid login is generic, rate-limited and audited without password. | I,E,S |
| AUTH-004 | P0 | Disabled user cannot log in and existing sessions cease to authorize. | I,E |
| AUTH-005 | P1 | User can list/revoke own sessions and revoke all others while current remains. | I,E |
| AUTH-006 | P0 | Password hashes, raw tokens and secrets never appear in DB plaintext fields, API payloads, logs or audit. | I,S |
| ISO-001 | P0 | For folder, document, version, trash, search, job and export APIs, User A cannot infer/read/mutate User B data using known IDs. | I,S |
| ISO-002 | P0 | Background job and download authorization are rechecked at execution/download time. | I,S |
| FOL-001 | P1 | Create, rename and move folder succeed and update tree without closing current editor. | I,E |
| FOL-002 | P0 | Moving a folder into itself/descendant fails with `FOLDER_CYCLE` and makes no change. | U,I,E |
| FOL-003 | P0 | Case/Unicode-equivalent sibling collisions are rejected consistently by UI/API/DB. | U,I,E |
| FOL-004 | P1 | Stable document URL still opens same document after ancestor rename/move. | E |
| DOC-001 | P1 | Create document accepts only safe `.md` name and no independent title metadata. | I,E |
| DOC-002 | P0 | Opening, previewing or switching editor modes without edits does not alter Markdown/revision. | I,E |
| DOC-003 | P1 | Rename/move/trash optimistic UI rolls back with clear error on server failure. | E |
| DOC-004 | P1 | Bulk selection performs Move/Download/Trash and reports per-item failures when applicable. | I,E |
| EDIT-001 | P1 | WYSIWYG, Source and desktop Split open same document and mode preference persists. | E,V |
| EDIT-002 | P0 | Save with current base revision commits once, increments revision and reports server-acknowledged Saved. | I,E |
| EDIT-003 | P0 | Stale base revision returns 409; server content is unchanged; local content remains recoverable; conflict UI appears. | I,E |
| EDIT-004 | P0 | Supported Markdown fixtures retain semantic equivalence after actual WYSIWYG edits. | U,E |
| EDIT-005 | P0 | Unknown/raw-preserved fixtures remain byte-identical through WYSIWYG load/save around unrelated edits. | U,E |
| EDIT-006 | P0 | Raw HTML/scripts/event handlers/unsafe protocols never execute; safe source remains stored. | U,E,S |
| EDIT-007 | P1 | Mermaid/math failure affects only its block and offers Source edit; rest of document remains usable. | E |
| EDIT-008 | P1 | WYSIWYG init failure offers Source mode without content loss. | E |
| EDIT-009 | P1 | Large-document mode activates at configured threshold and prevents known editor/render lockups. | E,performance |
| DRAFT-001 | P0 | Unsynced edits create versioned IndexedDB draft; confirmed matching save removes it. | E |
| DRAFT-002 | P0 | Reload/crash with newer local draft offers Review/Restore/Discard and never auto-overwrites server. | E |
| DRAFT-003 | P0 | Offline editing continues for current open document; reconnect checks revision before save. | E |
| DRAFT-004 | P1 | UI does not claim offline tree/search/other-document availability. | E |
| VER-001 | P0 | Import Replace snapshots old state and replaces content atomically. | I,E |
| VER-002 | P0 | Restoring a version preserves history, snapshots current state and creates a new revision. | I,E |
| VER-003 | P1 | Version preview/diff does not mutate current document or local draft. | E |
| TRASH-001 | P1 | Trash hides item from active navigation and lists one logical root with origin/time. | I,E |
| TRASH-002 | P1 | Restore to valid original parent succeeds; missing/collision path invokes explicit target/Keep Both. | I,E |
| TRASH-003 | P0 | Large permanent delete enters DELETING, completes in bounded restart-safe batches, and is unavailable through app afterward. | I,O |
| IMP-001 | P0 | Import cannot execute without valid preview plan bound to workspace/user and manifest. | I,S |
| IMP-002 | P1 | Preview accepts files/folder/ZIP, shows tree/counts/target/conflicts and aggregate ignored non-`.md` count. | I,E |
| IMP-003 | P0 | Traversal, absolute path, symlink, bomb/ratio, count, depth, size and invalid encoding inputs are rejected/reported safely. | I,S |
| IMP-004 | P1 | Keep Both is default and generates collision-free compatible names; Skip writes nothing. | U,I,E |
| IMP-005 | P0 | Replace creates protected version; batch `Apply to all` follows selected strategy. | I,E |
| IMP-006 | P0 | Partial success reports exact imported/skipped/failed totals and item reasons. | I,E |
| IMP-007 | P0 | Retry Failed does not duplicate or rerun successful items. | I,O,E |
| IMP-008 | P1 | Import modal can close; job continues; current editor stays open. | E |
| EXP-001 | P1 | Single document downloads exact current raw Markdown as safe `.md`. | I,E |
| EXP-002 | P0 | Folder/selection/workspace ZIP preserves visible hierarchy and includes no DB IDs/internal metadata. | I |
| EXP-003 | P0 | Concurrent edits during workspace export do not produce a mixed logical snapshot outside declared manifest semantics. | I,O |
| EXP-004 | P1 | Cross-platform filename changes are reported and do not mutate DB names. | I,E |
| EXP-005 | P0 | Export token is authorized/expiring; temp output is cleaned after retention/orphan sweep. | I,S,O |
| SRCH-001 | P1 | Search covers names and Markdown, scopes correctly, and returns path/snippet without leaking other workspaces. | I,E,S |
| SRCH-002 | P1 | Quick Open and Command Palette are fully keyboard operable and expose only valid actions. | E,V |
| SRCH-003 | P1 | Agreed English/CJK benchmark meets recorded relevance and latency threshold on representative corpus. | I,performance |
| PREF-001 | P2 | User preference change auto-saves with visible Saved/Error and restores prior state on failure. | I,E |
| PREF-002 | P1 | Theme/editor/document/search preferences apply and remain accessible at 200% zoom. | E,V |
| ADM-001 | P0 | Non-admin cannot see or call admin routes. | I,E,S |
| ADM-002 | P0 | Admin user detail contains counts/status only—no other user's document names, paths, snippets or bodies. | I,S |
| ADM-003 | P0 | Last active admin protection prevents removal of all administrators. | I,E |
| ADM-004 | P1 | System config requires review/explicit save, version guard, whole-patch validation and audit. | I,E |
| ADM-005 | P0 | Sanitizer/scripts/unsafe URL security floors are read-only/non-disableable. | I,E,S |
| JOB-001 | P0 | Accepted job survives API/worker restart and resumes/reclaims without duplicate terminal effects. | I,O |
| JOB-002 | P1 | Progress is monotonic; retry/cancel buttons appear only in valid states. | I,E |
| AUD-001 | P0 | Required auth/admin/destructive/export/job events are append-only and searchable without content/secrets. | I,S |
| ERR-001 | P1 | Known API failures map to scoped UX explaining event, data safety and recovery action; no raw stack/500 UI. | E |
| LOAD-001 | P2 | Tree/list/search refresh uses local skeleton/state and does not block editor. | E,V |
| UI-001 | P1 | Desktop implements four-zone knowledge workspace and paper/canvas hierarchy matching reference direction. | V |
| UI-002 | P1 | Favorites and Share are absent in V1 despite appearing in reference image. | E,V |
| UI-003 | P1 | Desktop/tablet/mobile layouts remain operable; mobile disables Split without squeezing desktop layout. | E,V |
| A11Y-001 | P1 | Core journeys pass automated accessibility checks plus manual keyboard/focus/dialog/tree review. | V |
| OPS-001 | P0 | Compose brings up proxy/Web/API/Worker/PostgreSQL; Web 27183 and API 27184 internally; DB is not publicly exposed. | O,S |
| OPS-002 | P0 | Invalid required config or incompatible migration prevents readiness with actionable safe error. | I,O |
| OPS-003 | P0 | Empty-to-current and previous-to-current migrations pass; documented backup restore drill succeeds. | I,O |
| OBS-001 | P1 | Request/job IDs connect safe UI support details to structured logs; health distinguishes liveness/readiness. | I,O |
| PERF-001 | P1 | Team records and meets budgets for document open/save, 10k-tree navigation, search, and job UI responsiveness on target hardware. | performance |

## Release rule

No P0/P1 row may be waived informally. A waiver requires an ADR naming the row, user impact, mitigation, expiry and owner. “Code compiles” or a screenshot alone is not acceptance evidence.

