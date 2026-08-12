import { z } from "zod";

export const OpaqueIdSchema = z.uuid();

export const LoginRequestSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1024),
});

export const PrincipalSchema = z.object({
  userId: z.uuid(),
  workspaceId: z.uuid(),
  sessionId: z.uuid(),
  username: z.string(),
  email: z.email(),
  displayName: z.string(),
  role: z.enum(["USER", "ADMIN"]),
  mustChangePassword: z.boolean(),
});

export const LoginResponseSchema = z.object({
  principal: PrincipalSchema,
});

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(12).max(1024),
});

export const SessionSummarySchema = z.object({
  id: z.uuid(),
  current: z.boolean(),
  userAgentSummary: z.string(),
  lastActiveAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export const SessionListSchema = z.object({
  data: z.array(SessionSummarySchema),
});

export const OperationResultSchema = z.object({
  success: z.literal(true),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type Principal = z.infer<typeof PrincipalSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type SessionList = z.infer<typeof SessionListSchema>;
export type OperationResult = z.infer<typeof OperationResultSchema>;
