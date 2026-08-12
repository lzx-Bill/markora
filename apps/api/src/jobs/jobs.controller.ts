import {
  type AcceptedJob,
  type BackgroundJob,
  type JobItemPage,
  OpaqueIdSchema,
} from "@markora/contracts";
import { Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { JobService } from "./job.service.js";

@Controller("jobs")
export class JobsController {
  @Inject(JobService)
  private readonly jobs!: JobService;

  @Get(":id")
  public get(@Param("id") id: string, @Req() request: RequestContext): Promise<BackgroundJob> {
    return this.jobs.get(request.principal, parseRequest(OpaqueIdSchema, id));
  }

  @Get(":id/items")
  public items(
    @Param("id") id: string,
    @Query("cursor") cursor: string | undefined,
    @Req() request: RequestContext,
  ): Promise<JobItemPage> {
    return this.jobs.items(request.principal, parseRequest(OpaqueIdSchema, id), cursor);
  }

  @Post(":id/cancel")
  public cancel(@Param("id") id: string, @Req() request: RequestContext): Promise<AcceptedJob> {
    return this.jobs.cancel(request.principal, parseRequest(OpaqueIdSchema, id), request.requestId);
  }

  @Post(":id/retry-failed")
  public retryFailed(
    @Param("id") id: string,
    @Req() request: RequestContext,
  ): Promise<AcceptedJob> {
    return this.jobs.retryFailed(
      request.principal,
      parseRequest(OpaqueIdSchema, id),
      request.requestId,
    );
  }
}
