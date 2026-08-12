import {
  AdminJobQuerySchema,
  AdminUserQuerySchema,
  AuditQuerySchema,
  CreateAdminUserRequestSchema,
  OpaqueIdSchema,
  ResetAdminPasswordRequestSchema,
  UpdateAdminConfigRequestSchema,
  UpdateAdminUserRequestSchema,
} from "@markora/contracts";
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminService } from "./admin.service.js";

@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  public constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get("overview") overview() {
    return this.admin.overview();
  }
  @Get("users") users(@Query() query: unknown) {
    return this.admin.users(parseRequest(AdminUserQuerySchema, query));
  }
  @Post("users") createUser(@Req() request: RequestContext, @Body() body: unknown) {
    return this.admin.createUser(
      request.principal,
      parseRequest(CreateAdminUserRequestSchema, body),
      request.requestId,
    );
  }
  @Get("users/:id") user(@Param("id") id: string) {
    return this.admin.user(parseRequest(OpaqueIdSchema, id));
  }
  @Patch("users/:id") updateUser(
    @Req() request: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.admin.updateUser(
      request.principal,
      parseRequest(OpaqueIdSchema, id),
      parseRequest(UpdateAdminUserRequestSchema, body),
      request.requestId,
    );
  }
  @Post("users/:id/reset-password") resetPassword(
    @Req() request: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.admin.resetPassword(
      request.principal,
      parseRequest(OpaqueIdSchema, id),
      parseRequest(ResetAdminPasswordRequestSchema, body),
      request.requestId,
    );
  }
  @Post("users/:id/revoke-sessions") revokeSessions(
    @Req() request: RequestContext,
    @Param("id") id: string,
  ) {
    return this.admin.revokeSessions(
      request.principal,
      parseRequest(OpaqueIdSchema, id),
      request.requestId,
    );
  }
  @Get("config") config() {
    return this.admin.config();
  }
  @Put("config") updateConfig(@Req() request: RequestContext, @Body() body: unknown) {
    return this.admin.updateConfig(
      request.principal,
      parseRequest(UpdateAdminConfigRequestSchema, body),
      request.requestId,
    );
  }
  @Get("security") security() {
    return this.admin.security();
  }
  @Get("jobs") jobs(@Query() query: unknown) {
    return this.admin.jobs(parseRequest(AdminJobQuerySchema, query));
  }
  @Post("jobs/:id/retry") retryJob(@Req() request: RequestContext, @Param("id") id: string) {
    return this.admin.retryJob(
      request.principal,
      parseRequest(OpaqueIdSchema, id),
      request.requestId,
    );
  }
  @Post("jobs/:id/cancel") cancelJob(@Req() request: RequestContext, @Param("id") id: string) {
    return this.admin.cancelJob(
      request.principal,
      parseRequest(OpaqueIdSchema, id),
      request.requestId,
    );
  }
  @Get("audit") audit(@Query() query: unknown) {
    return this.admin.audit(parseRequest(AuditQuerySchema, query));
  }
  @Get("health") health() {
    return this.admin.health();
  }
}
