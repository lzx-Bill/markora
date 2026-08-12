import { UpdatePreferencesRequestSchema } from "@markora/contracts";
import { Body, Controller, Get, Inject, Patch, Req } from "@nestjs/common";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { PreferencesService } from "./preferences.service.js";

@Controller("preferences")
export class PreferencesController {
  public constructor(
    @Inject(PreferencesService) private readonly preferences: PreferencesService,
  ) {}

  @Get()
  public get(@Req() request: RequestContext) {
    return this.preferences.get(request.principal);
  }

  @Patch()
  public update(@Req() request: RequestContext, @Body() body: unknown) {
    return this.preferences.update(
      request.principal,
      parseRequest(UpdatePreferencesRequestSchema, body),
      request.requestId,
    );
  }
}
