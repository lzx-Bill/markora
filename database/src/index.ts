import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client/client.js";

export type {
  Document,
  DocumentSaveReceipt,
  DocumentVersion,
  Folder,
} from "../generated/client/client.js";
export { Prisma } from "../generated/client/client.js";
export {
  AuditResult,
  DocumentVersionReason,
  ResourceState,
  UserRole,
  UserStatus,
} from "../generated/client/enums.js";

export type DatabaseClient = InstanceType<typeof PrismaClient>;

export function createDatabaseClient(connectionString: string): DatabaseClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
