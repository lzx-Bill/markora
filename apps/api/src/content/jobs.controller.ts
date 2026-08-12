import { type BackgroundJob, OpaqueIdSchema } from "@markora/contracts";
import { Controller, Get, Inject, Param, Req } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { CodedHttpException } from "../http/coded-http.exception.js";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { jobDto } from "./trash.service.js";

@Controller("jobs")
export class JobsController {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  @Get(":id")
  public async get(
    @Param("id") id: string,
    @Req() request: RequestContext,
  ): Promise<BackgroundJob> {
    const job = await this.database.client.backgroundJob.findFirst({
      where: {
        id: parseRequest(OpaqueIdSchema, id),
        workspaceId: request.principal.workspaceId,
        ownerUserId: request.principal.userId,
      },
    });
    if (!job) throw new CodedHttpException("NOT_FOUND", "Job not found.", 404);
    return jobDto(job);
  }
}
