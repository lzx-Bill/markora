# 02 — Domain and Data Specification

## 1. Ownership model

Every domain row is either system-scoped or workspace-scoped. Workspace-scoped repositories require an authenticated `workspace_id`; callers cannot request another workspace by supplying an ID. Admin metadata queries are separate read models and never reuse content-returning repositories.

V1 assigns exactly one workspace to each user. The schema retains `workspace_id` to enforce isolation and allow future evolution without changing present permissions.

## 2. Logical entities

| Entity | Required fields | Key rules |
|---|---|---|
| User | id, username, email, display_name, password_hash, role, status, must_change_password, created_at | username/email canonical unique; role USER/ADMIN; status ACTIVE/DISABLED |
| Session | id, user_id, token_hash/family, user_agent_summary, last_active_at, expires_at, revoked_at | raw token never stored/logged; revoke by ID/family |
| Workspace | id, owner_user_id, created_at | one per user; root is implicit |
| Folder | id, workspace_id, parent_id nullable, name, normalized_name, state, original_parent_id, created/updated/deleted timestamps | parent null means root child; sibling normalized uniqueness; no cycles |
| Document | id, workspace_id, folder_id nullable, name, normalized_name, markdown, revision, state, original_folder_id, created/updated/deleted timestamps | `.md`; sibling normalized uniqueness; revision increments per committed content/name/location mutation as specified |
| DocumentVersion | id, document_id, workspace_id, version_no, markdown, document_name, reason, source_revision, actor_id, created_at | immutable; unique(document_id, version_no) |
| UserPreference | user_id, schema_version, settings_json, updated_at | validated typed document; unknown future keys preserved only by version policy |
| SystemConfig | key, typed_value, version, updated_by, updated_at | allowlisted keys; optimistic update; security floor excluded |
| BackgroundJob | id, workspace_id nullable, owner_user_id nullable, type, state, progress, payload_json, checkpoint_json, result_json, error_code, attempts, timestamps, lease fields | durable state machine; payload excludes secret/content when avoidable |
| JobItem | id, job_id, source_key, state, result_json, error_code, attempts | enables partial success and retry-failed |
| AuditEvent | id, occurred_at, actor_user_id nullable, workspace_id nullable, action, target_type/id, result, request_id, metadata_json | append-only; no Markdown or secrets |
| LoginAttempt | id or aggregate key, subject/network hash, time bucket, count | rate-limit support without exposing raw sensitive detail |

## 3. Naming policy

One domain service implements validation for folders and documents.

1. Apply Unicode NFC for display storage and Unicode case-folding for collision key.
2. Trim leading/trailing whitespace; reject empty, `.` and `..`.
3. Reject `/`, `\\`, NUL/control characters, trailing dot/space, and cross-platform reserved device names.
4. Documents must end with lowercase-insensitive `.md`; preserve user-visible casing except extension may be normalized to `.md` by product policy and reported when import changes it.
5. Enforce configured length in Unicode code points and export-safe encoded path length.
6. Database unique constraints enforce `(workspace_id, parent_id/root sentinel, normalized_name, active namespace)` for folders and documents within their respective type. Product policy allows a folder and document with the same base label because the document includes `.md`.

Keep Both produces the first collision-free `name (n).md` or `folder (n)` under the same normalization policy.

## 4. States

### Folder/Document

`ACTIVE → TRASHED → DELETING → DELETED`

- `ACTIVE → TRASHED`: atomic logical operation on the selected root; descendants are effectively trashed by ancestor state, avoiding mass updates where practical.
- `TRASHED → ACTIVE`: validates target parent and conflicts first.
- `TRASHED → DELETING`: permanent-delete intent accepted and hidden from user navigation.
- `DELETING → DELETED`: background batches remove dependent versions/content, then root row. Small items may complete in the request using the same semantics.
- `DELETED` is terminal and normally represented by absence.

### BackgroundJob

`PENDING → RUNNING → SUCCEEDED | SUCCEEDED_WITH_ISSUES | FAILED | CANCELLED | INTERRUPTED`

- Retry creates a new attempt on the same job or a child job with provenance; idempotency key prevents duplicate effects.
- Worker lease expiration changes RUNNING to INTERRUPTED/reclaimable after checkpoint inspection.
- Cancel is cooperative and available only before irreversible completion.

## 5. Revision and version semantics

- `Document.revision` starts at 1 and increments atomically on every committed Markdown change. Rename/move return updated metadata but do not have to increment content revision; API supplies an entity `updated_at`/ETag for metadata concurrency if implemented.
- Save request carries `base_revision`. SQL update is conditional on current revision. Zero affected rows yields `REVISION_CONFLICT` and server metadata, never a last-write-wins overwrite.
- A version snapshot contains the pre-change document state when the operation is protective (Replace, restore, manual snapshot) and according to routine cadence for editing.
- Restoring version V snapshots current state, writes V content to current document, increments revision, and appends a `RESTORE` version/event. Version V remains immutable.
- Opening, rendering or mode switching without content change performs no write.

## 6. Transaction boundaries

| Operation | Boundary |
|---|---|
| Create/rename/move one item | One DB transaction including validation recheck and audit outbox/event |
| Save content | Conditional document update + required version snapshot + audit metadata in one transaction |
| Trash/restore small root | One transaction for root state/parent pointer and collision checks |
| Import item | One short transaction per item; job totals/checkpoint updated separately and idempotently |
| Import Replace | Snapshot old content + replace + revision increment in one item transaction |
| Large delete | State transition transaction, then bounded batches; never a workspace-size transaction |
| Workspace export | Consistent repeatable-read/logical snapshot or equivalent revision manifest captured before streaming |
| System config save | Validate full patch + compare config version + apply + audit in one transaction |

External/temporary-file operations do not occur while holding long database locks. Use an outbox or post-commit job enqueue pattern inside PostgreSQL so accepted jobs cannot disappear between commit and enqueue.

## 7. Import idempotency and provenance

Preview produces an opaque, expiring import plan ID bound to user/workspace and a manifest hash. Execution includes an idempotency key. Each source item has a deterministic source key and terminal outcome. Retrying failed items must not recreate successful items. Temporary extracted data is addressed only inside the job workspace and deleted after terminal retention.

## 8. Deletion and retention

- Application deletion removes live access immediately once `DELETING` begins.
- Routine cleanup uses configured Trash, version, audit, job-result and temp-workspace retention independently.
- Protected/manual versions are not removed by routine version pruning unless policy explicitly defines it.
- Database backups are outside application recovery. Documentation must state retention and that permanently deleted content may remain until backup expiry.

## 9. Indexes and database constraints

Required categories: normalized sibling uniqueness, workspace/state navigation indexes, document updated/name indexes, version `(document_id, version_no desc)`, job `(state, run_after/lease)`, audit `(occurred_at desc, actor, action, result)`, session user/revocation/expiry, and search vector/trigram/tokenizer-specific indexes selected by the CJK benchmark.

All foreign keys declare intentional delete behavior; no accidental cascade may allow deleting a user/workspace through an admin metadata action.

