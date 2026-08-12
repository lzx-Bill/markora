import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client/client.js";

export type {
  BackgroundJob,
  Document,
  DocumentSaveReceipt,
  DocumentVersion,
  ExportArtifact,
  ExportManifest,
  ExportManifestItem,
  Folder,
  ImportPlan,
  ImportUpload,
  JobItem,
} from "../generated/client/client.js";
export { Prisma } from "../generated/client/client.js";
export {
  AuditResult,
  BackgroundJobState,
  BackgroundJobType,
  DocumentVersionReason,
  JobItemState,
  ResourceState,
  UserRole,
  UserStatus,
} from "../generated/client/enums.js";
export { CURRENT_MIGRATION } from "./migrations.js";

export type DatabaseClient = InstanceType<typeof PrismaClient>;

export function createDatabaseClient(connectionString: string): DatabaseClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
