import type { HealthResponse } from "@markora/contracts";
import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  @Inject(HealthService)
  private readonly healthService!: HealthService;

  @Get("live")
  public liveness(): HealthResponse {
    return this.healthService.liveness();
  }

  @Get("ready")
  public async readiness(): Promise<HealthResponse> {
    try {
      return await this.healthService.readiness();
    } catch {
      throw new ServiceUnavailableException("A required dependency is unavailable.");
    }
  }
}
