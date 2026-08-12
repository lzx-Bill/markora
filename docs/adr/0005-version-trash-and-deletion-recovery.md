# ADR 0005 — Version, Trash and permanent-deletion recovery

## Status

Accepted for Phase 4 on 2026-08-12.

## Decisions

- Document versions are immutable pre-change snapshots. Routine saves may create `AUTO_SAVE`
  snapshots; conflict overwrite, import Replace and version restore always create protected snapshots.
- Restoring a version requires the current base revision, snapshots the current document with reason
  `RESTORE`, writes the selected historical content, and increments the current revision in one
  serializable transaction. Preview and line diff are read-only.
- Routine `AUTO_SAVE` snapshots are pruned in bounded worker batches after the configured 90-day
  default. Protected snapshots are not removed by routine pruning.
- Trash stores the original stable parent/root marker and display path at deletion time. Active reads
  resolve reachability from active roots, so one trashed folder represents its subtree without
  mutating every descendant.
- Restore never overwrites. An unavailable original parent requires an active target; a normalized
  sibling collision requires another target or deterministic `Keep Both` naming.
- Permanent deletion changes the root from `TRASHED` to `DELETING` and creates a durable job. The
  worker leases jobs, reclaims expired leases, and removes dependent rows in bounded batches.
  Absence is the terminal `DELETED` representation.
- The reusable background-job table is introduced now because restart-safe deletion is a Phase 4 P0
  requirement. Phase 6 extends it for import and export instead of adding a parallel queue.
- “Permanent” means unrecoverable through Markora. Encrypted backups can retain deleted content
  until their independent retention period expires.

## Verification

Real-PostgreSQL API tests cover immutable preview, protected Replace, revision-guarded restore,
logical Trash roots, missing targets, Keep Both, idempotent deletion intents and tenant isolation.
Worker tests cover bounded batches, expired-lease recovery, routine retention and terminal absence.
Chromium acceptance covers version preview/restore and Trash recovery/deletion with scoped errors.
