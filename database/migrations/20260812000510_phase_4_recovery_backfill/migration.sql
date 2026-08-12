UPDATE "folders"
SET "original_parent_is_root" = true,
    "original_path" = '/' || "name"
WHERE "state" = 'TRASHED' AND "parent_id" IS NULL AND "original_parent_id" IS NULL;

UPDATE "documents"
SET "original_folder_is_root" = true,
    "original_path" = '/' || "name"
WHERE "state" = 'TRASHED' AND "folder_id" IS NULL AND "original_folder_id" IS NULL;
