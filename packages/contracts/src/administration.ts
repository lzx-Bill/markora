import { z } from "zod";
import { OpaqueIdSchema } from "./auth.js";
import { BackgroundJobSchema } from "./recovery.js";

const preferenceFields = {
  language: z.enum(["en", "zh-CN"]),
  theme: z.enum(["LIGHT", "DARK", "SYSTEM"]),
  accent: z.enum(["BLUE", "INDIGO", "TEAL"]),
  density: z.enum(["COMFORTABLE", "COMPACT"]),
  interfaceFontSize: z.number().int().min(12).max(20),
  defaultEditorMode: z.enum(["wysiwyg", "source", "split"]),
  readingWidth: z.number().int().min(560).max(1400),
  editorFontSize: z.number().int().min(12).max(24),
  editorLineHeight: z.number().min(1.2).max(2.2),
  wrap: z.boolean(),
  tabSize: z.union([z.literal(2), z.literal(4)]),
  outline: z.boolean(),
  sourceLineNumbers: z.boolean(),
  autoSave: z.boolean(),
  mermaid: z.boolean(),
  math: z.boolean(),
  externalImages: z.boolean(),
  linkTarget: z.enum(["SAME_TAB", "NEW_TAB"]),
  documentSort: z.enum(["UPDATED", "NAME"]),
  documentDirection: z.enum(["ASC", "DESC"]),
  rememberExpandedFolders: z.boolean(),
  restoreLastWorkspaceState: z.boolean(),
  searchScope: z.enum(["WORKSPACE", "CURRENT_FOLDER"]),
  includeCodeBlocks: z.boolean(),
};

export const PreferenceSettingsSchema = z
  .object({
    language: preferenceFields.language.default("en"),
    theme: preferenceFields.theme.default("SYSTEM"),
    accent: preferenceFields.accent.default("BLUE"),
    density: preferenceFields.density.default("COMFORTABLE"),
    interfaceFontSize: preferenceFields.interfaceFontSize.default(16),
    defaultEditorMode: preferenceFields.defaultEditorMode.default("wysiwyg"),
    readingWidth: preferenceFields.readingWidth.default(960),
    editorFontSize: preferenceFields.editorFontSize.default(16),
    editorLineHeight: preferenceFields.editorLineHeight.default(1.6),
    wrap: preferenceFields.wrap.default(true),
    tabSize: preferenceFields.tabSize.default(2),
    outline: preferenceFields.outline.default(true),
    sourceLineNumbers: preferenceFields.sourceLineNumbers.default(true),
    autoSave: preferenceFields.autoSave.default(true),
    mermaid: preferenceFields.mermaid.default(true),
    math: preferenceFields.math.default(true),
    externalImages: preferenceFields.externalImages.default(false),
    linkTarget: preferenceFields.linkTarget.default("NEW_TAB"),
    documentSort: preferenceFields.documentSort.default("UPDATED"),
    documentDirection: preferenceFields.documentDirection.default("DESC"),
    rememberExpandedFolders: preferenceFields.rememberExpandedFolders.default(true),
    restoreLastWorkspaceState: preferenceFields.restoreLastWorkspaceState.default(true),
    searchScope: preferenceFields.searchScope.default("WORKSPACE"),
    includeCodeBlocks: preferenceFields.includeCodeBlocks.default(true),
  })
  .strict();

export const PreferenceSettingsPatchSchema = z.object(preferenceFields).partial().strict();
export const PreferenceResponseSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.number().int().positive(),
  displayName: z.string(),
  settings: PreferenceSettingsSchema,
  capabilities: z.object({ externalImages: z.boolean() }),
  updatedAt: z.iso.datetime().nullable(),
});
export const UpdatePreferencesRequestSchema = z
  .object({
    version: z.number().int().positive(),
    displayName: z.string().trim().min(1).max(100).optional(),
    settings: PreferenceSettingsPatchSchema.default({}),
  })
  .strict();

export const AdminConfigValuesSchema = z
  .object({
    documentMaxBytes: z.number().int().min(1024).max(52_428_800),
    trashRetentionDays: z.number().int().min(1).max(3650),
    versionRetentionDays: z.number().int().min(1).max(3650),
    sessionTtlDays: z.number().int().min(1).max(90),
    importMaxFiles: z.number().int().min(1).max(100_000),
    importMaxTotalBytes: z.number().int().min(1024).max(1_073_741_824),
    exportDownloadTtlMinutes: z.number().int().min(5).max(10_080),
    externalImagesEnabled: z.boolean(),
  })
  .strict();
export const AdminConfigResponseSchema = z.object({
  version: z.number().int().positive(),
  values: AdminConfigValuesSchema,
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: z.string().nullable(),
});
export const UpdateAdminConfigRequestSchema = z
  .object({ version: z.number().int().positive(), values: AdminConfigValuesSchema })
  .strict();

export const AdminUserSummarySchema = z.object({
  id: OpaqueIdSchema,
  username: z.string(),
  email: z.email(),
  displayName: z.string(),
  role: z.enum(["USER", "ADMIN"]),
  status: z.enum(["ACTIVE", "DISABLED"]),
  mustChangePassword: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const AdminUserDetailSchema = AdminUserSummarySchema.extend({
  counts: z.object({
    folders: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    jobs: z.number().int().nonnegative(),
  }),
  storageBytes: z.number().int().nonnegative(),
  lastActivityAt: z.iso.datetime().nullable(),
});
export const AdminUserListSchema = z.object({
  data: z.array(AdminUserSummarySchema),
  nextCursor: z.string().nullable(),
});
export const AdminUserQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
  cursor: z.string().optional(),
});
export const CreateAdminUserRequestSchema = z
  .object({
    username: z.string().trim().min(3).max(64),
    email: z.email(),
    displayName: z.string().trim().min(1).max(100),
    temporaryPassword: z.string().min(12).max(1024),
    role: z.enum(["USER", "ADMIN"]).default("USER"),
  })
  .strict();
export const UpdateAdminUserRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    role: z.enum(["USER", "ADMIN"]).optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");
export const ResetAdminPasswordRequestSchema = z
  .object({ temporaryPassword: z.string().min(12).max(1024) })
  .strict();

export const AdminOverviewSchema = z.object({
  counts: z.object({
    users: z.number().int().nonnegative(),
    activeUsers: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
    jobs: z.number().int().nonnegative(),
    failedJobs: z.number().int().nonnegative(),
    storageBytes: z.number().int().nonnegative(),
  }),
  components: z.object({
    api: z.enum(["HEALTHY", "DEGRADED"]),
    database: z.enum(["HEALTHY", "DEGRADED"]),
    worker: z.enum(["HEALTHY", "STALE", "UNKNOWN"]),
  }),
  recentIssues: z.array(
    z.object({
      jobId: OpaqueIdSchema,
      type: z.enum(["PERMANENT_DELETE_FOLDER", "PERMANENT_DELETE_DOCUMENT", "IMPORT", "EXPORT"]),
      state: z.enum(["FAILED", "INTERRUPTED"]),
      errorCode: z.string().nullable(),
      occurredAt: z.iso.datetime(),
    }),
  ),
  generatedAt: z.iso.datetime(),
});

export const AdminSecuritySchema = z.object({
  immutable: z.object({
    sanitizerRequired: z.literal(true),
    scriptsBlocked: z.literal(true),
    unsafeUrlsBlocked: z.literal(true),
    localFileUrlsBlocked: z.literal(true),
    archiveTraversalBlocked: z.literal(true),
  }),
  effective: z.object({
    loginWindowSeconds: z.number().int().positive(),
    loginMaxAttempts: z.number().int().positive(),
    passwordHash: z.literal("ARGON2ID"),
    sessionCookies: z.literal("HTTP_ONLY_SAME_SITE_STRICT"),
  }),
});

export const AdminJobQuerySchema = z.object({
  state: z
    .enum([
      "PENDING",
      "RUNNING",
      "SUCCEEDED",
      "SUCCEEDED_WITH_ISSUES",
      "FAILED",
      "CANCELLED",
      "INTERRUPTED",
    ])
    .optional(),
  type: z
    .enum(["PERMANENT_DELETE_FOLDER", "PERMANENT_DELETE_DOCUMENT", "IMPORT", "EXPORT"])
    .optional(),
  ownerUserId: OpaqueIdSchema.optional(),
  cursor: z.string().optional(),
});
export const AdminJobSchema = BackgroundJobSchema.omit({ targetId: true }).extend({
  owner: z.object({ id: OpaqueIdSchema, displayName: z.string() }),
  workspaceId: OpaqueIdSchema,
});
export const AdminJobListSchema = z.object({
  data: z.array(AdminJobSchema),
  nextCursor: z.string().nullable(),
});

export const AuditQuerySchema = z.object({
  actorUserId: OpaqueIdSchema.optional(),
  action: z.string().trim().max(100).optional(),
  result: z.enum(["SUCCESS", "FAILURE"]).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().optional(),
});
export const AuditEventSchema = z.object({
  id: OpaqueIdSchema,
  occurredAt: z.iso.datetime(),
  actor: z.object({ id: OpaqueIdSchema, displayName: z.string() }).nullable(),
  workspaceId: OpaqueIdSchema.nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  result: z.enum(["SUCCESS", "FAILURE"]),
  requestId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});
export const AuditEventListSchema = z.object({
  data: z.array(AuditEventSchema),
  nextCursor: z.string().nullable(),
});
export const AdminHealthSchema = z.object({
  status: z.enum(["HEALTHY", "DEGRADED"]),
  apiVersion: z.string(),
  databaseVersion: z.string(),
  migrationCount: z.number().int().nonnegative(),
  uptimeSeconds: z.number().int().nonnegative(),
  workerLastSeenAt: z.iso.datetime().nullable(),
  checkedAt: z.iso.datetime(),
});

export type PreferenceSettings = z.infer<typeof PreferenceSettingsSchema>;
export type PreferenceResponse = z.infer<typeof PreferenceResponseSchema>;
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequestSchema>;
export type AdminConfigValues = z.infer<typeof AdminConfigValuesSchema>;
export type AdminConfigResponse = z.infer<typeof AdminConfigResponseSchema>;
export type UpdateAdminConfigRequest = z.infer<typeof UpdateAdminConfigRequestSchema>;
export type AdminUserSummary = z.infer<typeof AdminUserSummarySchema>;
export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>;
export type AdminUserList = z.infer<typeof AdminUserListSchema>;
export type AdminUserQuery = z.infer<typeof AdminUserQuerySchema>;
export type CreateAdminUserRequest = z.infer<typeof CreateAdminUserRequestSchema>;
export type UpdateAdminUserRequest = z.infer<typeof UpdateAdminUserRequestSchema>;
export type ResetAdminPasswordRequest = z.infer<typeof ResetAdminPasswordRequestSchema>;
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;
export type AdminSecurity = z.infer<typeof AdminSecuritySchema>;
export type AdminJobQuery = z.infer<typeof AdminJobQuerySchema>;
export type AdminJob = z.infer<typeof AdminJobSchema>;
export type AdminJobList = z.infer<typeof AdminJobListSchema>;
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type AuditEventList = z.infer<typeof AuditEventListSchema>;
export type AdminHealth = z.infer<typeof AdminHealthSchema>;
