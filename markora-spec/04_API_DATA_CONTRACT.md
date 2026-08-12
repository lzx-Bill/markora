# 04 — API and Data Contract

## 1. General protocol

Base path: `/api/v1`. JSON uses camelCase. Timestamps are UTC ISO-8601. IDs are opaque UUID-like strings. List endpoints use cursor pagination; sort fields are allowlisted. Mutations accept `Idempotency-Key` when retry could duplicate work.

Browser authentication is same-origin opaque-session cookie based. Mutating routes enforce the chosen CSRF token/origin contract. The API never returns a reusable session token in JSON. Non-browser API tokens are out of V1 scope.

Success returns the resource or `{ data, page }`. Errors use:

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "The document changed after you opened it.",
    "requestId": "req_…",
    "details": { "documentId": "…", "serverRevision": 18 }
  }
}
```

User messages are safe; details never include Markdown unless the specific conflict endpoint requires an authenticated comparison payload. Canonical statuses: 400 validation, 401 unauthenticated, 403 forbidden, 404 not found (including cross-workspace), 409 conflict, 413 limit, 422 semantic validation, 429 rate limit, 503 unavailable.

## 2. Authentication and account endpoints

| Method | Path | Contract |
|---|---|---|
| POST | `/auth/login` | username/email + password; creates/rotates secure session |
| POST | `/auth/logout` | revoke current session |
| GET | `/auth/me` | principal, role, workspace, mustChangePassword |
| POST | `/account/password` | current + new password; revoke/rotate policy |
| GET | `/sessions` | safe device summaries only |
| DELETE | `/sessions/{id}` | own session revoke |
| POST | `/sessions/revoke-others` | revoke all except current |

No public `/register` or forgot-password email endpoint.

## 3. Navigation and content endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/workspace` | workspace/root summary |
| GET | `/folders/tree` | active tree, counts/version token |
| POST | `/folders` | `{parentId,name}` |
| PATCH | `/folders/{id}` | rename and/or move with expected metadata token |
| POST | `/folders/{id}/trash` | soft-delete root |
| POST | `/folders/{id}/restore` | target parent + conflict strategy |
| DELETE | `/folders/{id}` | permanent-delete intent; may return job |
| GET | `/documents` | folder, recursive, query, sort, cursor filters |
| POST | `/documents` | `{folderId,name,markdown?}` |
| GET | `/documents/{id}` | content, revision, capabilities, breadcrumbs |
| PATCH | `/documents/{id}` | metadata rename/move |
| PUT | `/documents/{id}/content` | `{markdown,baseRevision,clientMutationId}` |
| POST | `/documents/{id}/trash` | soft delete |
| POST | `/documents/{id}/restore` | restore strategy |
| DELETE | `/documents/{id}` | permanent delete |
| POST | `/documents/bulk` | typed Move/Trash operation over explicit IDs |

Content save success:

```json
{ "documentId":"doc_…", "revision":19, "savedAt":"…", "versionCreated":false }
```

Conflict (`409 REVISION_CONFLICT`) supplies server revision, saved time and a short-lived authorized comparison handle or server Markdown only when needed by the conflict UI. Client never retries a stale write automatically.

## 4. Versions

| Method | Path | Notes |
|---|---|---|
| GET | `/documents/{id}/versions` | metadata cursor list |
| GET | `/documents/{id}/versions/{versionId}` | snapshot for preview/diff |
| POST | `/documents/{id}/versions` | manual snapshot if exposed |
| POST | `/documents/{id}/versions/{versionId}/restore` | `baseRevision`; creates new current revision |

## 5. Search and commands

`GET /search?q=&scope=all|folder|subtree&folderId=&includeCodeBlocks=&cursor=` returns `{documentId,name,path,snippet,score,matchHints}`. `GET /quick-open?q=` returns a small recency/name-ranked set. Command definitions are client-owned except role/capability data from `/auth/me` and resource DTOs.

## 6. Trash

`GET /trash?type=&cursor=` returns deleted root items, original path, deletion time and retention/eligibility metadata. Descendants represented by a trashed ancestor are not duplicated as independent roots. Bulk restore/delete has explicit item results when not atomic.

## 7. Import

1. `POST /imports/uploads` accepts streamed multipart/archive input with limits and creates expiring upload token.
2. `POST /imports/preview` accepts upload token + target folder, validates/extracts safely, and returns `planId`, tree summary, ignored count, warnings, conflicts, normalized names, expiration.
3. `POST /imports/{planId}/execute` accepts default conflict strategy and per-item overrides; returns `202 {jobId}`.
4. `GET /jobs/{jobId}` exposes progress and safe result summary.
5. `POST /jobs/{jobId}/retry-failed` retries only retryable failed items.

Preview and execute revalidate ownership, plan hash, expiry, system limits and target state. Replace is a protected versioning operation.

## 8. Download/export

- `GET /documents/{id}/download` streams one `.md` with safe Content-Disposition.
- `POST /exports` accepts `{scope: selection|folder|workspace, ids?, folderId?}` and returns immediate stream for small eligible work or `202 jobId`.
- `GET /exports/{jobId}/download` uses an expiring, authorization-checked token after success.

Manifest is captured before generation. ZIP contains no application metadata. Report contains only compatibility name mappings/warnings. Temp outputs expire and cannot be enumerated.

## 9. Preferences and admin

| Method | Path | Notes |
|---|---|---|
| GET/PATCH | `/preferences` | typed partial auto-save with preference version |
| GET | `/admin/overview` | counts/status, no content |
| GET/POST | `/admin/users` | list/create users |
| GET/PATCH | `/admin/users/{id}` | metadata/status/role with last-admin protection |
| POST | `/admin/users/{id}/reset-password` | temporary reset state; never return stored password |
| POST | `/admin/users/{id}/revoke-sessions` | audited |
| GET/PUT | `/admin/config` | versioned staged patch, explicit apply |
| GET | `/admin/security` | effective floors/status |
| GET | `/admin/jobs` | filters and operational metadata |
| POST | `/admin/jobs/{id}/retry` | valid states only |
| POST | `/admin/jobs/{id}/cancel` | cooperative cancellation |
| GET | `/admin/audit` | metadata filters/details |
| GET | `/admin/health` | components/build/migration status |

Admin user detail never returns document names, paths, snippets or bodies—only counts/storage/last activity/security metadata.

## 10. Required error codes

`VALIDATION_FAILED`, `NAME_CONFLICT`, `INVALID_NAME`, `FOLDER_CYCLE`, `NOT_FOUND`, `FORBIDDEN`, `REVISION_CONFLICT`, `RESOURCE_STATE_CONFLICT`, `LIMIT_EXCEEDED`, `INVALID_ENCODING`, `UNSAFE_ARCHIVE`, `PLAN_EXPIRED`, `JOB_NOT_RETRYABLE`, `JOB_NOT_CANCELLABLE`, `SESSION_REVOKED`, `RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE`, `CONFIG_VERSION_CONFLICT`.

Every code maps to a UX state/action in `05_UX_SPEC.md` and at least one integration/E2E assertion.
