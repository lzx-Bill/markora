import {
  BulkDocumentRequestSchema,
  type BulkDocumentResult,
  CreateDocumentRequestSchema,
  type DocumentDetail,
  type DocumentList,
  OpaqueIdSchema,
  type TrashResult,
  UpdateDocumentRequestSchema,
} from "@markora/contracts";
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { ContentService } from "./content.service.js";

@Controller("documents")
export class DocumentsController {
  @Inject(ContentService)
  private readonly content!: ContentService;

  @Get()
  public list(
    @Query("folderId") folderId: string | undefined,
    @Req() request: RequestContext,
  ): Promise<DocumentList> {
    return this.content.listDocuments(
      request.principal,
      folderId === undefined || folderId === "root" ? null : parseRequest(OpaqueIdSchema, folderId),
    );
  }

  @Post()
  public create(@Body() body: unknown, @Req() request: RequestContext): Promise<DocumentDetail> {
    return this.content.createDocument(
      request.principal,
      parseRequest(CreateDocumentRequestSchema, body),
      request.requestId,
    );
  }

  @Post("bulk")
  public bulk(@Body() body: unknown, @Req() request: RequestContext): Promise<BulkDocumentResult> {
    return this.content.bulkDocuments(
      request.principal,
      parseRequest(BulkDocumentRequestSchema, body),
      request.requestId,
    );
  }

  @Get(":id")
  public get(@Param("id") id: string, @Req() request: RequestContext): Promise<DocumentDetail> {
    return this.content.getDocument(request.principal, parseRequest(OpaqueIdSchema, id));
  }

  @Patch(":id")
  public update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: RequestContext,
  ): Promise<DocumentDetail> {
    return this.content.updateDocument(
      request.principal,
      parseRequest(OpaqueIdSchema, id),
      parseRequest(UpdateDocumentRequestSchema, body),
      request.requestId,
    );
  }

  @Post(":id/trash")
  public trash(@Param("id") id: string, @Req() request: RequestContext): Promise<TrashResult> {
    return this.content.trashDocument(
      request.principal,
      parseRequest(OpaqueIdSchema, id),
      request.requestId,
    );
  }
}
