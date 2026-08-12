ALTER TYPE "BackgroundJobType" ADD VALUE 'IMPORT';
ALTER TYPE "BackgroundJobType" ADD VALUE 'EXPORT';

CREATE TYPE "JobItemState" AS ENUM (
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'SKIPPED',
  'FAILED',
  'CANCELLED'
);

ALTER TABLE "background_jobs"
  ADD COLUMN "payload_json" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "parent_job_id" UUID,
  ADD COLUMN "cancellation_requested" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_parent_job_id_fkey"
  FOREIGN KEY ("parent_job_id") REFERENCES "background_jobs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "background_jobs_owner_type_idempotency_key_key"
  ON "background_jobs"("owner_user_id", "type", "idempotency_key");
CREATE INDEX "background_jobs_parent_job_id_idx" ON "background_jobs"("parent_job_id");

CREATE TABLE "job_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "job_id" UUID NOT NULL,
  "source_key" TEXT NOT NULL,
  "state" "JobItemState" NOT NULL DEFAULT 'PENDING',
  "payload_json" JSONB NOT NULL DEFAULT '{}',
  "result_json" JSONB,
  "error_code" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "job_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_items_job_id_source_key_key" ON "job_items"("job_id", "source_key");
CREATE INDEX "job_items_job_id_state_created_at_idx" ON "job_items"("job_id", "state", "created_at");
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "background_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "import_uploads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "temp_path" TEXT NOT NULL,
  "manifest_hash" TEXT NOT NULL,
  "manifest_json" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_uploads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "import_uploads_token_hash_key" ON "import_uploads"("token_hash");
CREATE INDEX "import_uploads_expires_at_idx" ON "import_uploads"("expires_at");
CREATE INDEX "import_uploads_workspace_id_owner_user_id_idx" ON "import_uploads"("workspace_id", "owner_user_id");
ALTER TABLE "import_uploads" ADD CONSTRAINT "import_uploads_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_uploads" ADD CONSTRAINT "import_uploads_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "import_plans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "upload_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "target_folder_id" UUID,
  "manifest_hash" TEXT NOT NULL,
  "preview_json" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "executed_job_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "import_plans_executed_job_id_key" ON "import_plans"("executed_job_id");
CREATE INDEX "import_plans_expires_at_idx" ON "import_plans"("expires_at");
CREATE INDEX "import_plans_workspace_id_owner_user_id_idx" ON "import_plans"("workspace_id", "owner_user_id");
ALTER TABLE "import_plans" ADD CONSTRAINT "import_plans_upload_id_fkey"
  FOREIGN KEY ("upload_id") REFERENCES "import_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_plans" ADD CONSTRAINT "import_plans_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_plans" ADD CONSTRAINT "import_plans_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "export_manifests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "job_id" UUID NOT NULL,
  "scope" TEXT NOT NULL,
  "report_json" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "export_manifests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "export_manifests_job_id_key" ON "export_manifests"("job_id");
ALTER TABLE "export_manifests" ADD CONSTRAINT "export_manifests_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "background_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "export_manifest_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "manifest_id" UUID NOT NULL,
  "source_document_id" UUID NOT NULL,
  "display_path" TEXT NOT NULL,
  "archive_path" TEXT NOT NULL,
  "markdown" TEXT NOT NULL,
  "source_revision" INTEGER NOT NULL,
  "normalized" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "export_manifest_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "export_manifest_items_manifest_id_archive_path_key"
  ON "export_manifest_items"("manifest_id", "archive_path");
CREATE INDEX "export_manifest_items_manifest_id_id_idx"
  ON "export_manifest_items"("manifest_id", "id");
ALTER TABLE "export_manifest_items" ADD CONSTRAINT "export_manifest_items_manifest_id_fkey"
  FOREIGN KEY ("manifest_id") REFERENCES "export_manifests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "export_artifacts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "job_id" UUID NOT NULL,
  "file_path" TEXT NOT NULL,
  "byte_size" BIGINT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "export_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "export_artifacts_job_id_key" ON "export_artifacts"("job_id");
CREATE INDEX "export_artifacts_expires_at_idx" ON "export_artifacts"("expires_at");
ALTER TABLE "export_artifacts" ADD CONSTRAINT "export_artifacts_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "background_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
