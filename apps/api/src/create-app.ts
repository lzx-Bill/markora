import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./error.filter.js";
import { requestIdMiddleware } from "./http/request-id.middleware.js";

export async function createApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();
  return app;
}
