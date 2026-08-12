CREATE UNIQUE INDEX "folders_id_workspace_id_key" ON "folders"("id", "workspace_id");

ALTER TABLE "folders" DROP CONSTRAINT "folders_parent_id_fkey";
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_workspace_fkey"
  FOREIGN KEY ("parent_id", "workspace_id") REFERENCES "folders"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "documents" DROP CONSTRAINT "documents_folder_id_fkey";
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_workspace_fkey"
  FOREIGN KEY ("folder_id", "workspace_id") REFERENCES "folders"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
