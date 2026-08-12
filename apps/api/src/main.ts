import "reflect-metadata";
import { loadServerConfig } from "@markora/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./error.filter.js";

const config = loadServerConfig(process.env);
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useGlobalFilters(new ApiExceptionFilter());
app.setGlobalPrefix("api/v1");
app.enableShutdownHooks();
await app.listen(config.API_PORT, config.API_HOST);

Logger.log(`API listening on ${config.API_HOST}:${config.API_PORT}`, "Bootstrap");
