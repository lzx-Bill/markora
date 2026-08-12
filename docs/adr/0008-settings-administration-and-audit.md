# ADR 0008 — Typed runtime settings, metadata-only administration and append-only audit

## Status

Accepted for Markora V1 Phase 7.

## Decision

- User preferences are a versioned typed JSON document. `PATCH /preferences` accepts a true partial object with no injected defaults, serializes rapid browser saves, and rolls back to the last confirmed value on failure.
- Installation settings are one fully validated, versioned `runtime-v1` record. The Admin UI stages the complete record, presents a review step, then applies it explicitly. API and Worker read the current record for document, session, retention, import and export behavior; environment values are the bootstrap defaults.
- Security floors remain code/deployment policy. The database setting can enable safe HTTP(S) image loading as an installation ceiling, while sanitizer, script, unsafe-protocol, local-file and archive-traversal protections cannot be disabled.
- Administration uses dedicated metadata projections. User detail returns identity/status, aggregate counts, aggregate UTF-8 bytes and last activity; it never calls a content-returning repository or selects document names, paths, snippets or Markdown.
- Audit rows are searchable operational metadata and PostgreSQL rejects row updates and deletes. Sensitive metadata keys are redacted before an admin response.
- Worker liveness is reported through a database heartbeat so Admin health reflects the same running deployment rather than a simulated status.

## Consequences

- Config writes take effect for new operations without restarting API or Worker processes.
- Request middleware keeps a fixed hard ceiling; application services enforce the current lower runtime limit.
- Runtime reads add a small database lookup to affected operations. This favors immediate, deterministic configuration over cache invalidation complexity for V1.
- Audit retention will require a separately authorized maintenance mechanism because ordinary `UPDATE` and `DELETE` are intentionally impossible.

## Verification

- Real PostgreSQL integration covers version conflicts, runtime document limits, external-image ceilings, last-admin protection, session revocation, privacy-negative reads, export retry snapshots, audit immutability and health.
- Worker integration changes retention settings between maintenance passes and observes the new policy without restart.
- Real Chromium covers rapid preference persistence, 200% reflow, user creation, config review/apply, security floors, audit, health and non-admin route isolation.
