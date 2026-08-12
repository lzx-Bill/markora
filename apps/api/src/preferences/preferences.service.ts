import {
  type PreferenceResponse,
  PreferenceSettingsSchema,
  type Principal,
  type UpdatePreferencesRequest,
} from "@markora/contracts";
import { Prisma } from "@markora/database";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { CodedHttpException } from "../http/coded-http.exception.js";
import { RuntimeConfigService } from "../runtime-config/runtime-config.service.js";

@Injectable()
export class PreferencesService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  @Inject(RuntimeConfigService)
  private readonly runtimeConfig!: RuntimeConfigService;

  public async get(principal: Principal): Promise<PreferenceResponse> {
    const [user, preference, runtime] = await Promise.all([
      this.database.client.user.findUniqueOrThrow({ where: { id: principal.userId } }),
      this.database.client.userPreference.findUnique({ where: { userId: principal.userId } }),
      this.runtimeConfig.values(),
    ]);
    return response(user.displayName, preference, runtime.externalImagesEnabled);
  }

  public async update(
    principal: Principal,
    input: UpdatePreferencesRequest,
    requestId: string,
  ): Promise<PreferenceResponse> {
    const runtime = await this.runtimeConfig.values();
    if (input.settings.externalImages === true && !runtime.externalImagesEnabled) {
      throw new CodedHttpException(
        "RESOURCE_STATE_CONFLICT",
        "External images are disabled by the installation administrator.",
        409,
      );
    }
    return this.database.client.$transaction(
      async (transaction) => {
        const current = await transaction.userPreference.findUnique({
          where: { userId: principal.userId },
        });
        const currentVersion = current?.version ?? 1;
        if (currentVersion !== input.version) {
          throw new CodedHttpException(
            "CONFIG_VERSION_CONFLICT",
            "Preferences changed elsewhere. Reload them and retry.",
            409,
            { currentVersion },
          );
        }
        const settings = PreferenceSettingsSchema.parse({
          ...PreferenceSettingsSchema.parse(current?.settings ?? {}),
          ...input.settings,
        });
        const nextVersion = currentVersion + 1;
        const preference = await transaction.userPreference.upsert({
          where: { userId: principal.userId },
          create: {
            userId: principal.userId,
            schemaVersion: 1,
            version: nextVersion,
            settings: settings as Prisma.InputJsonValue,
          },
          update: {
            schemaVersion: 1,
            version: nextVersion,
            settings: settings as Prisma.InputJsonValue,
          },
        });
        const user = input.displayName
          ? await transaction.user.update({
              where: { id: principal.userId },
              data: { displayName: input.displayName },
            })
          : await transaction.user.findUniqueOrThrow({ where: { id: principal.userId } });
        await transaction.auditEvent.create({
          data: {
            actorUserId: principal.userId,
            workspaceId: principal.workspaceId,
            action: "preferences.update",
            targetType: "user-preferences",
            targetId: principal.userId,
            result: "SUCCESS",
            requestId,
            metadata: {
              keys: Object.keys(input.settings),
              displayName: Boolean(input.displayName),
            },
          },
        });
        return response(user.displayName, preference, runtime.externalImagesEnabled);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

function response(
  displayName: string,
  preference: {
    schemaVersion: number;
    version: number;
    settings: unknown;
    updatedAt: Date;
  } | null,
  externalImagesAllowed: boolean,
): PreferenceResponse {
  const settings = PreferenceSettingsSchema.parse(preference?.settings ?? {});
  return {
    schemaVersion: 1,
    version: preference?.version ?? 1,
    displayName,
    settings: { ...settings, externalImages: settings.externalImages && externalImagesAllowed },
    capabilities: { externalImages: externalImagesAllowed },
    updatedAt: preference?.updatedAt.toISOString() ?? null,
  };
}
