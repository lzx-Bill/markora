import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { OpenApiController } from "./openapi.controller.js";

@Module({
  controllers: [HealthController, OpenApiController],
  providers: [HealthService],
})
export class AppModule {}
