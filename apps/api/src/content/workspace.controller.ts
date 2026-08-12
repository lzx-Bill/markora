import type { WorkspaceSummary } from "@markora/contracts";
import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { RequestContext } from "../http/request-context.js";
import { ContentService } from "./content.service.js";

@Controller("workspace")
export class WorkspaceController {
  @Inject(ContentService)
  private readonly content!: ContentService;

  @Get()
  public get(@Req() request: RequestContext): Promise<WorkspaceSummary> {
    return this.content.workspace(request.principal);
  }
}
