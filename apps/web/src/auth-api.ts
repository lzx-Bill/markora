import {
  ApiErrorSchema,
  LoginResponseSchema,
  OperationResultSchema,
  type Principal,
  PrincipalSchema,
  type SessionList,
  SessionListSchema,
} from "@markora/contracts";

async function apiRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw new Error(
      parsed.success ? parsed.data.error.message : "The request could not be completed.",
    );
  }
  return body;
}

export async function getCurrentPrincipal(): Promise<Principal | null> {
  const response = await fetch("/api/v1/auth/me", { credentials: "same-origin" });
  if (response.status === 401) return null;
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw new Error(parsed.success ? parsed.data.error.message : "Markora could not be loaded.");
  }
  return PrincipalSchema.parse(body);
}

export async function login(identifier: string, password: string): Promise<Principal> {
  const body = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
  return LoginResponseSchema.parse(body).principal;
}

export async function logout(): Promise<void> {
  OperationResultSchema.parse(await apiRequest("/auth/logout", { method: "POST" }));
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  OperationResultSchema.parse(
    await apiRequest("/account/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  );
}

export async function listSessions(): Promise<SessionList> {
  return SessionListSchema.parse(await apiRequest("/sessions"));
}

export async function revokeSession(sessionId: string): Promise<void> {
  OperationResultSchema.parse(await apiRequest(`/sessions/${sessionId}`, { method: "DELETE" }));
}

export async function revokeOtherSessions(): Promise<void> {
  OperationResultSchema.parse(await apiRequest("/sessions/revoke-others", { method: "POST" }));
}
