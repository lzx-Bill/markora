import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AccountController } from "./account.controller.js";
import { AuditService } from "./audit.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { CsrfGuard } from "./csrf.guard.js";
import { LoginRateLimitService } from "./login-rate-limit.service.js";
import { PasswordService } from "./password.service.js";
import { SessionsController } from "./sessions.controller.js";

@Module({
  controllers: [AuthController, AccountController, SessionsController],
  providers: [
    PasswordService,
    AuditService,
    LoginRateLimitService,
    AuthService,
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
