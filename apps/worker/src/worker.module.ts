import { Module } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import { ImportExportRunner } from "./import-export.runner.js";
import { PermanentDeletionRunner } from "./permanent-deletion.runner.js";
import { RuntimeConfigService } from "./runtime-config.service.js";
import { WorkerService } from "./worker.service.js";

@Module({
  providers: [
    DatabaseService,
    RuntimeConfigService,
    PermanentDeletionRunner,
    ImportExportRunner,
    WorkerService,
  ],
})
export class WorkerModule {}
