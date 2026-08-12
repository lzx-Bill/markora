ALTER TYPE "DocumentVersionReason" ADD VALUE 'RESTORE';
ALTER TYPE "DocumentVersionReason" ADD VALUE 'IMPORT_REPLACE';

ALTER TABLE "folders"
  ADD COLUMN "original_parent_is_root" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "original_path" TEXT;
ALTER TABLE "documents"
  ADD COLUMN "original_folder_is_root" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "original_path" TEXT;

CREATE TYPE "BackgroundJobType" AS ENUM (
  'PERMANENT_DELETE_FOLDER',
  'PERMANENT_DELETE_DOCUMENT'
);

CREATE TYPE "BackgroundJobState" AS ENUM (
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'SUCCEEDED_WITH_ISSUES',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED'
);

CREATE TABLE "background_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "type" "BackgroundJobType" NOT NULL,
  "state" "BackgroundJobState" NOT NULL DEFAULT 'PENDING',
  "target_type" TEXT NOT NULL,
  "target_id" UUID NOT NULL,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "checkpoint_json" JSONB NOT NULL DEFAULT '{}',
  "result_json" JSONB,
  "error_code" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "run_after" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMPTZ(3),
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "background_jobs_progress_range" CHECK ("progress" BETWEEN 0 AND 100),
  CONSTRAINT "background_jobs_attempts_nonnegative" CHECK ("attempts" >= 0)
);

CREATE INDEX "background_jobs_state_run_after_lease_expires_at_idx"
  ON "background_jobs"("state", "run_after", "lease_expires_at");
CREATE INDEX "background_jobs_workspace_id_created_at_idx"
  ON "background_jobs"("workspace_id", "created_at" DESC);
CREATE INDEX "background_jobs_workspace_id_target_type_target_id_idx"
  ON "background_jobs"("workspace_id", "target_type", "target_id");
CREATE UNIQUE INDEX "background_jobs_active_permanent_delete_target_key"
  ON "background_jobs"("workspace_id", "target_type", "target_id")
  WHERE "type" IN ('PERMANENT_DELETE_FOLDER', 'PERMANENT_DELETE_DOCUMENT')
    AND "state" IN ('PENDING', 'RUNNING', 'SUCCEEDED');

ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
