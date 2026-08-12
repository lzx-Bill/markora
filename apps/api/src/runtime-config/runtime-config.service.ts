import { loadServerConfig } from "@markora/config";
import { type AdminConfigValues, AdminConfigValuesSchema } from "@markora/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";

export const runtimeConfigKey = "runtime-v1";

@Injectable()
export class RuntimeConfigService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  public async values(): Promise<AdminConfigValues> {
    const row = await this.database.client.systemConfig.findUnique({
      where: { key: runtimeConfigKey },
      select: { typedValue: true },
    });
    return AdminConfigValuesSchema.parse(row?.typedValue ?? this.defaults());
  }

  public defaults(): AdminConfigValues {
    const config = loadServerConfig(process.env);
    return AdminConfigValuesSchema.parse({
      documentMaxBytes: config.DOCUMENT_MAX_BYTES,
      trashRetentionDays: config.TRASH_RETENTION_DAYS,
      versionRetentionDays: config.VERSION_RETENTION_DAYS,
      sessionTtlDays: config.SESSION_TTL_DAYS,
      importMaxFiles: config.IMPORT_MAX_FILES,
      importMaxTotalBytes: config.IMPORT_MAX_TOTAL_BYTES,
      exportDownloadTtlMinutes: config.EXPORT_DOWNLOAD_TTL_MINUTES,
      externalImagesEnabled: false,
    });
  }
}
