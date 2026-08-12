import { createHmac, timingSafeEqual } from "node:crypto";

export interface ExportDownloadGrant {
  jobId: string;
  userId: string;
  workspaceId: string;
  expiresAt: string;
}

export function signExportDownload(grant: ExportDownloadGrant, secret: string): string {
  const payload = Buffer.from(JSON.stringify(grant), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyExportDownload(token: string, secret: string): ExportDownloadGrant | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!isGrant(parsed) || Date.parse(parsed.expiresAt) <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isGrant(value: unknown): value is ExportDownloadGrant {
  if (!value || typeof value !== "object") return false;
  const grant = value as Record<string, unknown>;
  return (
    typeof grant.jobId === "string" &&
    typeof grant.userId === "string" &&
    typeof grant.workspaceId === "string" &&
    typeof grant.expiresAt === "string" &&
    Number.isFinite(Date.parse(grant.expiresAt))
  );
}
