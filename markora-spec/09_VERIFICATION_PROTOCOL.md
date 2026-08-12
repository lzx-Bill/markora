# 09 — Verification Protocol

## 1. Required test layers

- **Unit**: naming normalization/collision, hierarchy cycles/depth, state machines, capability transforms, sanitization policies, version cadence, error mapping.
- **Integration**: application service + real PostgreSQL for transactions, isolation, revisions, job leases/idempotency, imports/exports, migrations.
- **Contract**: OpenAPI/schema generation and generated-client compatibility; error-code exhaustiveness.
- **E2E**: browser journeys, keyboard/focus, local draft/offline, conflict, background progress, settings/admin.
- **Security**: cross-workspace IDOR matrix, XSS corpus, CSRF/auth/session, archive attacks, rate limits, log/audit redaction.
- **Visual/accessibility**: reference-based screenshots and manual screen/keyboard checks across viewports/themes/states.
- **Operational**: clean install, upgrade, worker kill/restart, API outage, PostgreSQL recovery, backup restore, temp orphan cleanup.

## 2. Canonical fixtures

`tests/fixtures/markdown` must include headings/lists/quotes, nested emphasis, links/protocols, URL images, code languages, GFM tables/tasks/strike, Mermaid valid/invalid, inline/block math valid/invalid, safe/unsafe raw HTML, unknown directives/frontmatter-like syntax, Unicode/CJK/emoji, very long lines, large document, mixed line endings and raw-preserved sentinel bytes.

`tests/fixtures/import` must include normal tree, duplicate normalized names, case collisions, invalid UTF-8, non-`.md`, deep tree, too-large file, traversal (`../`), absolute path, backslash traversal, symlink, duplicate ZIP entries, high compression ratio and partial-failure batch.

`tests/fixtures/tenancy` must include at least two users/workspaces with colliding opaque IDs referenced in every route-family test.

## 3. Markdown equivalence oracle

- For structured supported syntax, compare normalized AST/semantic rendering plus critical source attributes, not raw string equality.
- For raw-preserved ranges, compare exact bytes/string code units.
- For no-edit flows, compare entire original Markdown exactly and verify no DB update/revision change.
- For unsafe HTML, verify source persistence separately from non-execution/sanitized output.

## 4. Failure injection

Inject: save timeout after client draft write; revision race; DB deadlock/retry; worker death between item commit/checkpoint; disk-full/temp unavailable; export during concurrent saves; expired plan/token; revoked session mid-job; malformed renderer input; config-version race. Each test asserts durable state, idempotent retry, user-facing safety statement and audit/log redaction.

## 5. Performance gates

Record target hardware and data shape before freezing numbers. Minimum scenarios: 10k folders/tree nodes, 10k documents, 300-document import, 300-document export, max normal document open/save, large-document fallback, English/CJK search corpus, 20 concurrent auto-saves, multiple job types under configured concurrency. Measure p50/p95/p99 server latency where relevant and browser long tasks/memory for editor/tree.

Provisional UX budgets: cached shell feedback <100 ms; skeleton by 200 ms; normal document usable p95 <2 s on local deployment; auto-save acknowledgement p95 <1 s excluding debounce; normal search p95 <500 ms. Final values require recorded benchmark evidence, not silent relaxation.

## 6. Visual QA checklist

Compare against `assets/ui-reference.png` for spatial hierarchy, neutral warmth, blue restraint, floating paper/panels and density—not pixel identity. Capture desktop 1600×900, tablet 1024×768 and mobile 390×844 in light/dark for: populated workspace, empty, loading, error, long names, editor modes, outline, save failed, offline, conflict, trash, version preview, import preview/progress/result, Settings and Admin. Confirm Favorites/Share absent.

## 7. Accessibility protocol

Run automated axe-like checks, then manual keyboard-only workflows: login; create/open/edit; tree navigation; menus/dialogs; search palette; conflict; import; settings; admin. Verify focus return, no keyboard trap except intentional modal containment, announcements for save/job state, headings/landmarks, 200% zoom/reflow, contrast, target size and reduced motion.

## 8. Migration and recovery protocol

For every release candidate:

1. Migrate empty DB and seed bootstrap.
2. Restore previous representative backup, run new migrations, verify counts/checksums/sample content.
3. Start old-compatible/new processes according to expand-contract plan.
4. Kill worker during import/delete/export and verify recovery without duplicate successful items.
5. Restore backup into isolated instance and run smoke/ownership tests.
6. Record commands, versions, duration, evidence and any manual steps.

## 9. Acceptance evidence

Create `artifacts/acceptance/<ID>/` during implementation containing machine-readable test result and, where useful, screenshot/log excerpt with secrets/content redacted. Maintain a generated index mapping every P0/P1 acceptance ID to test name and latest result. A requirement with no evidence is not complete.

## 10. Final release checklist

- All P0/P1 matrix rows green; P2 status recorded.
- No skipped isolation, sanitizer, revision, import safety, job restart or migration tests.
- OpenAPI and generated client clean; migrations deterministic.
- Dependency/security scan triaged; no known exploitable critical/high issue in shipped path.
- Production compose/proxy config passes header, TLS assumption, private DB and readiness checks.
- Operator docs cover bootstrap, config/secrets, backup/restore, upgrade, job/temp cleanup and emergency local-draft limitations.
- Product scope audit confirms excluded V1 features are not exposed.
