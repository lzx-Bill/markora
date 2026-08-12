import { Module } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import { PermanentDeletionRunner } from "./permanent-deletion.runner.js";
import { WorkerService } from "./worker.service.js";

@Module({ providers: [DatabaseService, PermanentDeletionRunner, WorkerService] })
export class WorkerModule {}
