import {
  type AcceptedJob,
  ExecuteImportRequestSchema,
  ImportPreviewRequestSchema,
  type ImportPreviewResult,
  type ImportUploadResult,
  OpaqueIdSchema,
} from "@markora/contracts";
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import type { Express } from "express";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { ImportService } from "./import.service.js";
import { ImportFilesInterceptor } from "./upload.interceptor.js";

@Controller("imports")
export class ImportsController {
  @Inject(ImportService)
  private readonly imports!: ImportService;

  @Post("uploads")
  @UseInterceptors(ImportFilesInterceptor)
  public upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body("relativePaths") relativePaths: unknown,
    @Req() request: RequestContext,
  ): Promise<ImportUploadResult> {
    return this.imports.upload(request.principal, files ?? [], relativePaths, request.requestId);
  }

  @Post("preview")
  public preview(
    @Body() body: unknown,
    @Req() request: RequestContext,
  ): Promise<ImportPreviewResult> {
    return this.imports.preview(
      request.principal,
      parseRequest(ImportPreviewRequestSchema, body),
      request.requestId,
    );
  }

  @Post(":planId/execute")
  @HttpCode(202)
  public execute(
    @Param("planId") planId: string,
    @Body() body: unknown,
    @Req() request: RequestContext,
  ): Promise<AcceptedJob> {
    return this.imports.execute(
      request.principal,
      parseRequest(OpaqueIdSchema, planId),
      parseRequest(ExecuteImportRequestSchema, body),
      request.requestId,
    );
  }
}
