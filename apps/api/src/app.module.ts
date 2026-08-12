import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { ContentModule } from "./content/content.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { OpenApiController } from "./openapi.controller.js";

@Module({
  imports: [DatabaseModule, AuthModule, ContentModule],
  controllers: [HealthController, OpenApiController],
  providers: [HealthService],
})
export class AppModule {}
