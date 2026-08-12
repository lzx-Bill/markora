import type { TrashList } from "@markora/contracts";
import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { CodedHttpException } from "../http/coded-http.exception.js";
import type { RequestContext } from "../http/request-context.js";
import { TrashService } from "./trash.service.js";

@Controller("trash")
export class TrashController {
  @Inject(TrashService)
  private readonly trash!: TrashService;

  @Get()
  public list(
    @Query("type") type: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Req() request: RequestContext,
  ): Promise<TrashList> {
    if (type !== undefined && type !== "FOLDER" && type !== "DOCUMENT") {
      throw new CodedHttpException("VALIDATION_FAILED", "Trash type is invalid.", 400);
    }
    return this.trash.list(request.principal, type, cursor);
  }
}
