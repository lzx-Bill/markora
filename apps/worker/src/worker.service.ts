import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";

@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private heartbeat: NodeJS.Timeout | undefined;

  public onModuleInit(): void {
    this.logger.log("Worker ready; durable job handlers arrive in Phase 6.");
    this.heartbeat = setInterval(() => undefined, 60_000);
  }

  public onApplicationShutdown(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
  }
}
