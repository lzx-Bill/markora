import {
  type DocumentVersionDetail,
  type DocumentVersionList,
  OpaqueIdSchema,
  RestoreDocumentVersionRequestSchema,
  type RestoreDocumentVersionResult,
} from "@markora/contracts";
import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { VersionService } from "./version.service.js";

@Controller("documents/:documentId/versions")
export class VersionsController {
  @Inject(VersionService)
  private readonly versions!: VersionService;

  @Get()
  public list(
    @Param("documentId") documentId: string,
    @Query("cursor") cursor: string | undefined,
    @Req() request: RequestContext,
  ): Promise<DocumentVersionList> {
    return this.versions.list(request.principal, parseRequest(OpaqueIdSchema, documentId), cursor);
  }

  @Get(":versionId")
  public get(
    @Param("documentId") documentId: string,
    @Param("versionId") versionId: string,
    @Req() request: RequestContext,
  ): Promise<DocumentVersionDetail> {
    return this.versions.get(
      request.principal,
      parseRequest(OpaqueIdSchema, documentId),
      parseRequest(OpaqueIdSchema, versionId),
    );
  }

  @Post(":versionId/restore")
  public restore(
    @Param("documentId") documentId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: RequestContext,
  ): Promise<RestoreDocumentVersionResult> {
    return this.versions.restore(
      request.principal,
      parseRequest(OpaqueIdSchema, documentId),
      parseRequest(OpaqueIdSchema, versionId),
      parseRequest(RestoreDocumentVersionRequestSchema, body),
      request.requestId,
    );
  }
}
