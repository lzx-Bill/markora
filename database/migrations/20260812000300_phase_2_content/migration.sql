CREATE TYPE "ResourceState" AS ENUM ('ACTIVE', 'TRASHED', 'DELETING');

CREATE TABLE "folders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "parent_id" UUID,
  "name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "state" "ResourceState" NOT NULL DEFAULT 'ACTIVE',
  "original_parent_id" UUID,
  "deleted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "folder_id" UUID,
  "name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "markdown" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "state" "ResourceState" NOT NULL DEFAULT 'ACTIVE',
  "original_folder_id" UUID,
  "deleted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "documents_revision_positive" CHECK ("revision" >= 1)
);

CREATE INDEX "folders_workspace_id_state_parent_id_idx" ON "folders"("workspace_id", "state", "parent_id");
CREATE INDEX "folders_parent_id_idx" ON "folders"("parent_id");
CREATE INDEX "documents_workspace_id_state_folder_id_updated_at_idx" ON "documents"("workspace_id", "state", "folder_id", "updated_at" DESC);
CREATE INDEX "documents_folder_id_idx" ON "documents"("folder_id");

-- NULL parents represent the implicit root, so ordinary SQL UNIQUE semantics are insufficient.
CREATE UNIQUE INDEX "folders_active_sibling_name_key"
  ON "folders"("workspace_id", COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), "normalized_name")
  WHERE "state" = 'ACTIVE';
CREATE UNIQUE INDEX "documents_active_sibling_name_key"
  ON "documents"("workspace_id", COALESCE("folder_id", '00000000-0000-0000-0000-000000000000'::uuid), "normalized_name")
  WHERE "state" = 'ACTIVE';

ALTER TABLE "folders" ADD CONSTRAINT "folders_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "folders" ADD CONSTRAINT "folders_original_parent_id_fkey"
  FOREIGN KEY ("original_parent_id") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_fkey"
  FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_original_folder_id_fkey"
  FOREIGN KEY ("original_folder_id") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
