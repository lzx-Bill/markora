import {
  CreateExportResultSchema,
  DownloadTokenQuerySchema,
  ExportRequestSchema,
  OpaqueIdSchema,
} from "@markora/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { ExportService } from "./export.service.js";

@Controller()
export class ExportsController {
  @Inject(ExportService)
  private readonly exports!: ExportService;

  @Get("documents/:id/download")
  public async document(
    @Param("id") id: string,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const result = await this.exports.directDocument(
      request.principal,
      parseRequest(OpaqueIdSchema, id),
      request.requestId,
    );
    response.setHeader("Content-Type", "text/markdown; charset=utf-8");
    response.setHeader("Content-Disposition", contentDisposition(result.name));
    return new StreamableFile(Buffer.from(result.markdown, "utf8"));
  }

  @Post("exports")
  @HttpCode(202)
  public async create(@Body() body: unknown, @Req() request: RequestContext) {
    return CreateExportResultSchema.parse(
      await this.exports.create(
        request.principal,
        parseRequest(ExportRequestSchema, body),
        request.requestId,
      ),
    );
  }

  @Get("exports/:jobId/download")
  public async download(
    @Param("jobId") jobId: string,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const query = parseRequest(DownloadTokenQuerySchema, request.query);
    const result = await this.exports.download(
      request.principal,
      parseRequest(OpaqueIdSchema, jobId),
      query.token,
      request.requestId,
    );
    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Disposition", contentDisposition(result.name));
    return new StreamableFile(result.stream);
  }
}

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/gu, "_").replaceAll('"', "");
  return `attachment; filename="${ascii || "download"}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
