import { loadServerConfig } from "@markora/config";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./error.filter.js";
import { requestIdMiddleware } from "./http/request-id.middleware.js";

export async function createApplication(): Promise<INestApplication> {
  const config = loadServerConfig(process.env);
  const app = await NestFactory.create(AppModule, { bodyParser: false, bufferLogs: true });
  const runtimeDocumentCeiling = 52_428_800;
  app.use(
    json({ limit: Math.max(config.DOCUMENT_MAX_BYTES, runtimeDocumentCeiling) * 2 + 65_536 }),
  );
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();
  return app;
}
