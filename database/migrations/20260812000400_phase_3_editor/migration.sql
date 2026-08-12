CREATE TYPE "DocumentVersionReason" AS ENUM ('AUTO_SAVE', 'CONFLICT_OVERWRITE');

CREATE UNIQUE INDEX "documents_id_workspace_id_key" ON "documents"("id", "workspace_id");

CREATE TABLE "document_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "markdown" TEXT NOT NULL,
  "document_name" TEXT NOT NULL,
  "reason" "DocumentVersionReason" NOT NULL,
  "source_revision" INTEGER NOT NULL,
  "actor_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_versions_version_no_positive" CHECK ("version_no" >= 1),
  CONSTRAINT "document_versions_source_revision_positive" CHECK ("source_revision" >= 1)
);

CREATE TABLE "document_save_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "client_mutation_id" UUID NOT NULL,
  "base_revision" INTEGER NOT NULL,
  "markdown_hash" TEXT NOT NULL,
  "result_revision" INTEGER NOT NULL,
  "version_created" BOOLEAN NOT NULL,
  "saved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_save_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_save_receipts_base_revision_positive" CHECK ("base_revision" >= 1),
  CONSTRAINT "document_save_receipts_result_revision_positive" CHECK ("result_revision" >= 1)
);

CREATE UNIQUE INDEX "document_versions_document_id_version_no_key"
  ON "document_versions"("document_id", "version_no");
CREATE INDEX "document_versions_workspace_id_document_id_version_no_idx"
  ON "document_versions"("workspace_id", "document_id", "version_no" DESC);
CREATE UNIQUE INDEX "document_save_receipts_document_id_client_mutation_id_key"
  ON "document_save_receipts"("document_id", "client_mutation_id");
CREATE INDEX "document_save_receipts_workspace_id_saved_at_idx"
  ON "document_save_receipts"("workspace_id", "saved_at" DESC);

ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_workspace_fkey"
  FOREIGN KEY ("document_id", "workspace_id") REFERENCES "documents"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_save_receipts" ADD CONSTRAINT "document_save_receipts_document_workspace_fkey"
  FOREIGN KEY ("document_id", "workspace_id") REFERENCES "documents"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
