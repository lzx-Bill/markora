import {
  CreateFolderRequestSchema,
  type Folder,
  type FolderTree,
  OpaqueIdSchema,
  type TrashResult,
  UpdateFolderRequestSchema,
} from "@markora/contracts";
import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { ContentService } from "./content.service.js";

@Controller("folders")
export class FoldersController {
  @Inject(ContentService)
  private readonly content!: ContentService;

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
}
