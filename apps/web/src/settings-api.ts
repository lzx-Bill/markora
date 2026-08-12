import {
  AdminConfigResponseSchema,
  type AdminConfigValues,
  AdminHealthSchema,
  AdminJobListSchema,
  AdminOverviewSchema,
  AdminSecuritySchema,
  AdminUserDetailSchema,
  AdminUserListSchema,
  type AdminUserSummary,
  AdminUserSummarySchema,
  AuditEventListSchema,
  OperationResultSchema,
  PreferenceResponseSchema,
  type PreferenceSettings,
  type UpdateAdminUserRequest,
} from "@markora/contracts";
import { apiRequest } from "./workspace-api.js";

export const getPreferences = async () =>
  PreferenceResponseSchema.parse(await apiRequest("/preferences"));
export const updatePreferences = async (
  version: number,
  settings: Partial<PreferenceSettings>,
  displayName?: string,
) =>
  PreferenceResponseSchema.parse(
    await apiRequest("/preferences", {
      method: "PATCH",
      body: JSON.stringify({ version, settings, ...(displayName ? { displayName } : {}) }),
    }),
  );
export const getAdminOverview = async () =>
  AdminOverviewSchema.parse(await apiRequest("/admin/overview"));
export const getAdminUsers = async (
  query: { q?: string; status?: "ACTIVE" | "DISABLED"; role?: "USER" | "ADMIN" } = {},
) => AdminUserListSchema.parse(await apiRequest(withQuery("/admin/users", query)));
export const getAdminUser = async (id: string) =>
  AdminUserDetailSchema.parse(await apiRequest(`/admin/users/${id}`));
export const createAdminUser = async (input: {
  username: string;
  email: string;
  displayName: string;
  temporaryPassword: string;
  role: "USER" | "ADMIN";
}) =>
  AdminUserSummarySchema.parse(
    await apiRequest("/admin/users", { method: "POST", body: JSON.stringify(input) }),
  );
export const updateAdminUser = async (
  id: string,
  input: UpdateAdminUserRequest,
): Promise<AdminUserSummary> =>
  AdminUserSummarySchema.parse(
    await apiRequest(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  );
export const resetAdminPassword = async (id: string, temporaryPassword: string) =>
  OperationResultSchema.parse(
    await apiRequest(`/admin/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ temporaryPassword }),
    }),
  );
export const revokeAdminSessions = async (id: string) =>
  OperationResultSchema.parse(
    await apiRequest(`/admin/users/${id}/revoke-sessions`, { method: "POST" }),
  );
export const getAdminConfig = async () =>
  AdminConfigResponseSchema.parse(await apiRequest("/admin/config"));
export const updateAdminConfig = async (version: number, values: AdminConfigValues) =>
  AdminConfigResponseSchema.parse(
    await apiRequest("/admin/config", { method: "PUT", body: JSON.stringify({ version, values }) }),
  );
export const getAdminSecurity = async () =>
  AdminSecuritySchema.parse(await apiRequest("/admin/security"));
export const getAdminJobs = async (
  query: { state?: string; type?: string; ownerUserId?: string } = {},
) => AdminJobListSchema.parse(await apiRequest(withQuery("/admin/jobs", query)));
export const retryAdminJob = async (id: string) =>
  apiRequest(`/admin/jobs/${id}/retry`, { method: "POST" });
export const cancelAdminJob = async (id: string) =>
  apiRequest(`/admin/jobs/${id}/cancel`, { method: "POST" });
export const getAdminAudit = async (
  query: { actorUserId?: string; action?: string; result?: "SUCCESS" | "FAILURE" } = {},
) => AuditEventListSchema.parse(await apiRequest(withQuery("/admin/audit", query)));
export const getAdminHealth = async () =>
  AdminHealthSchema.parse(await apiRequest("/admin/health"));

function withQuery(path: string, query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}
