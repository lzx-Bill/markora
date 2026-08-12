import { pathToFileURL } from "node:url";
import { loadBootstrapConfig, loadServerConfig } from "@markora/config";
import {
  AuditResult,
  createDatabaseClient,
  type DatabaseClient,
  Prisma,
  UserRole,
  UserStatus,
} from "@markora/database";
import { canonicalizeIdentity } from "@markora/domain";
import { PasswordService } from "./auth/password.service.js";

export class BootstrapDisabledError extends Error {
  public constructor() {
    super("Bootstrap is disabled because at least one user already exists.");
    this.name = "BootstrapDisabledError";
  }
}

export async function bootstrapAdmin(
  database: DatabaseClient,
  environment: NodeJS.ProcessEnv,
): Promise<{ userId: string; workspaceId: string; username: string }> {
  const bootstrap = loadBootstrapConfig(environment);
  const passwordHash = await new PasswordService().hash(bootstrap.BOOTSTRAP_ADMIN_PASSWORD);

  return database.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('markora:bootstrap-admin'))`;
      if ((await transaction.user.count()) !== 0) throw new BootstrapDisabledError();

      const user = await transaction.user.create({
        data: {
          username: bootstrap.BOOTSTRAP_ADMIN_USERNAME,
          usernameCanonical: canonicalizeIdentity(bootstrap.BOOTSTRAP_ADMIN_USERNAME),
          email: bootstrap.BOOTSTRAP_ADMIN_EMAIL,
          emailCanonical: canonicalizeIdentity(bootstrap.BOOTSTRAP_ADMIN_EMAIL),
          displayName: bootstrap.BOOTSTRAP_ADMIN_DISPLAY_NAME,
          passwordHash,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          mustChangePassword: true,
          workspace: { create: {} },
        },
        include: { workspace: true },
      });
      if (!user.workspace) throw new Error("Bootstrap workspace creation failed.");

      await transaction.auditEvent.create({
        data: {
          actorUserId: user.id,
          workspaceId: user.workspace.id,
          action: "bootstrap.admin.create",
          targetType: "user",
          targetId: user.id,
          result: AuditResult.SUCCESS,
          requestId: "bootstrap_cli",
          metadata: { role: "ADMIN" },
        },
      });
      return { userId: user.id, workspaceId: user.workspace.id, username: user.username };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function main(): Promise<void> {
  const server = loadServerConfig(process.env);
  const database = createDatabaseClient(server.DATABASE_URL);
  try {
    const result = await bootstrapAdmin(database, process.env);
    console.info(`Bootstrap admin created: ${result.username} (${result.userId})`);
  } finally {
    await database.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Bootstrap failed.";
    console.error(message);
    process.exitCode = 1;
  });
}
