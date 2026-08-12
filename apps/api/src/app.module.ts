import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { ContentModule } from "./content/content.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { ImportExportModule } from "./import-export/import-export.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { OpenApiController } from "./openapi.controller.js";
import { SearchModule } from "./search/search.module.js";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ContentModule,
    SearchModule,
    ImportExportModule,
    JobsModule,
  ],
  controllers: [HealthController, OpenApiController],
  providers: [HealthService],
})
export class AppModule {}
