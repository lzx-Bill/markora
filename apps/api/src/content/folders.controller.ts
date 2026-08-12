import {
  CreateFolderRequestSchema,
  type Folder,
  type FolderTree,
  OpaqueIdSchema,
  type PermanentDeleteResult,
  RestoreResourceRequestSchema,
  type RestoreResourceResult,
  type TrashResult,
  UpdateFolderRequestSchema,
} from "@markora/contracts";
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { ContentService } from "./content.service.js";
import { TrashService } from "./trash.service.js";

@Controller("folders")
export class FoldersController {
  @Inject(ContentService)
  private readonly content!: ContentService;

  @Inject(TrashService)
  private readonly recovery!: TrashService;

  @Get("tree")
  public tree(@Req() request: RequestContext): Promise<FolderTree> {
    return this.content.folderTree(request.principal);
  }

  @Post()
  public create(@Body() body: unknown, @Req() request: RequestContext): Promise<Folder> {
    return this.content.createFolder(
      request.principal,
      parseRequest(CreateFolderRequestSchema, body),
      request.requestId,
    );
  }

  @Patch(":id")
  public update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: RequestContext,
  ): Promise<Folder> {
    return this.content.updateFolder(
      request.principal,
      parseRequest(OpaqueIdSchema, id),
      parseRequest(UpdateFolderRequestSchema, body),
      request.requestId,
    );
  }

  @Post(":id/trash")
  public trash(@Param("id") id: string, @Req() request: RequestContext): Promise<TrashResult> {
    return this.content.trashFolder(
      request.principal,
      parseRequest(OpaqueIdSchema, id),
      request.requestId,
    );
  }

  @Post(":id/restore")
  public restore(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: RequestContext,
  ): Promise<RestoreResourceResult> {
    return this.recovery.restoreFolder(
      request.principal,
      parseRequest(OpaqueIdSchema, id),
      parseRequest(RestoreResourceRequestSchema, body),
      request.requestId,
    );
  }

  @Delete(":id")
  public delete(
    @Param("id") id: string,
    @Req() request: RequestContext,
  ): Promise<PermanentDeleteResult> {
    return this.recovery.deleteFolder(
      request.principal,
      parseRequest(OpaqueIdSchema, id),
      request.requestId,
    );
  }
}
