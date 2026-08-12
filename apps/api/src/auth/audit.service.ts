import { AuditResult, type Prisma } from "@markora/database";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";

export interface AuditInput {
  readonly actorUserId?: string;
  readonly workspaceId?: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string;
  readonly result: "SUCCESS" | "FAILURE";
  readonly requestId: string;
  readonly metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  public async record(input: AuditInput): Promise<void> {
    await this.database.client.auditEvent.create({
      data: {
        action: input.action,
        targetType: input.targetType,
        result: input.result === "SUCCESS" ? AuditResult.SUCCESS : AuditResult.FAILURE,
        requestId: input.requestId,
        metadata: input.metadata ?? {},
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.targetId ? { targetId: input.targetId } : {}),
      },
    });
  }
}
