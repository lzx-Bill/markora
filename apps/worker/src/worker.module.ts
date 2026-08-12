import { Module } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import { ImportExportRunner } from "./import-export.runner.js";
import { PermanentDeletionRunner } from "./permanent-deletion.runner.js";
import { WorkerService } from "./worker.service.js";

@Module({
  providers: [DatabaseService, PermanentDeletionRunner, ImportExportRunner, WorkerService],
})
export class WorkerModule {}
