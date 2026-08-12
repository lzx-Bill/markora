import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { loadUploadStorageConfig } from "@markora/config";
import { privatePath } from "@markora/portability";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { diskStorage } from "multer";

interface UploadRequest extends Request {
  markoraUploadDirectory?: string;
}

const uploadConfig = loadUploadStorageConfig(process.env);
const runtimeFileCountCeiling = 100_000;

export const ImportFilesInterceptor = FilesInterceptor("files", runtimeFileCountCeiling, {
  preservePath: true,
  limits: {
    files: runtimeFileCountCeiling,
    fileSize: uploadConfig.IMPORT_UPLOAD_MAX_BYTES,
    fields: 10,
    parts: runtimeFileCountCeiling + 10,
  },
  storage: diskStorage({
    destination(request: UploadRequest, _file, callback) {
      try {
        const directory =
          request.markoraUploadDirectory ??
          privatePath(uploadConfig.TEMP_ROOT, "imports", `upload_${randomUUID()}`);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        request.markoraUploadDirectory = directory;
        callback(null, directory);
      } catch (error) {
        callback(error as Error, "");
      }
    },
    filename(_request, _file, callback) {
      callback(null, `source_${randomUUID()}`);
    },
  }),
});
