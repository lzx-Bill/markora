import { loadServerConfig } from "@markora/config";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { PermanentDeletionRunner } from "./permanent-deletion.runner.js";

@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private heartbeat: NodeJS.Timeout | undefined;
  private readonly config = loadServerConfig(process.env);
  private running = false;

  public constructor(
    @Inject(PermanentDeletionRunner) private readonly deletion: PermanentDeletionRunner,
  ) {}

  public onModuleInit(): void {
    this.logger.log("Worker ready with restart-safe permanent deletion jobs.");
    void this.tick();
    this.heartbeat = setInterval(() => void this.tick(), this.config.WORKER_POLL_MS);
  }

  public onApplicationShutdown(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.deletion.runMaintenanceOnce();
      while (await this.deletion.runOnce()) {
        // Drain ready work while each individual transaction remains bounded.
      }
    } catch (error) {
      this.logger.error("Worker polling failed", error);
    } finally {
      this.running = false;
    }
  }
}
