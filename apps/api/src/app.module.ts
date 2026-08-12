import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { ContentModule } from "./content/content.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { ImportExportModule } from "./import-export/import-export.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { OpenApiController } from "./openapi.controller.js";
import { PreferencesModule } from "./preferences/preferences.module.js";
import { RuntimeConfigModule } from "./runtime-config/runtime-config.module.js";
import { SearchModule } from "./search/search.module.js";

@Module({
  imports: [
    DatabaseModule,
    RuntimeConfigModule,
    AuthModule,
    ContentModule,
    SearchModule,
    ImportExportModule,
    JobsModule,
    PreferencesModule,
    AdminModule,
  ],
  controllers: [HealthController, OpenApiController],
  providers: [HealthService],
})
export class AppModule {}
