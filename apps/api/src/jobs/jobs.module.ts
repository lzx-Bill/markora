import { Module } from "@nestjs/common";
import { JobService } from "./job.service.js";
import { JobsController } from "./jobs.controller.js";

@Module({ controllers: [JobsController], providers: [JobService] })
export class JobsModule {}
