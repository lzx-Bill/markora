import "reflect-metadata";
import { loadServerConfig } from "@markora/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker.module.js";

loadServerConfig(process.env);
const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
app.enableShutdownHooks();
Logger.log("Worker process started.", "Bootstrap");
