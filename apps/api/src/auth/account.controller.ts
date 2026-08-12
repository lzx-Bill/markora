import { ChangePasswordRequestSchema, type OperationResult } from "@markora/contracts";
import { Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { RequestContext } from "../http/request-context.js";
import { parseRequest } from "../http/validation.js";
import { AuthService } from "./auth.service.js";

@Controller("account")
export class AccountController {
  @Inject(AuthService)
  private readonly auth!: AuthService;

  @Post("password")
  @HttpCode(200)
  public async changePassword(
    @Body() body: unknown,
    @Req() request: RequestContext,
  ): Promise<OperationResult> {
    const input = parseRequest(ChangePasswordRequestSchema, body);
    await this.auth.changePassword(
      request.principal,
      input.currentPassword,
      input.newPassword,
      request.requestId,
    );
    return { success: true };
  }
}
