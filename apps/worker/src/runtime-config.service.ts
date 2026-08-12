import { loadServerConfig } from "@markora/config";
import { type AdminConfigValues, AdminConfigValuesSchema } from "@markora/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";

@Injectable()
export class RuntimeConfigService {
  public constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  public async values(): Promise<AdminConfigValues> {
    const row = await this.database.client.systemConfig.findUnique({
      where: { key: "runtime-v1" },
      select: { typedValue: true },
    });
    const config = loadServerConfig(process.env);
    return AdminConfigValuesSchema.parse(
      row?.typedValue ?? {
        documentMaxBytes: config.DOCUMENT_MAX_BYTES,
        trashRetentionDays: config.TRASH_RETENTION_DAYS,
        versionRetentionDays: config.VERSION_RETENTION_DAYS,
        sessionTtlDays: config.SESSION_TTL_DAYS,
        importMaxFiles: config.IMPORT_MAX_FILES,
        importMaxTotalBytes: config.IMPORT_MAX_TOTAL_BYTES,
        exportDownloadTtlMinutes: config.EXPORT_DOWNLOAD_TTL_MINUTES,
        externalImagesEnabled: false,
      },
    );
  }
}
