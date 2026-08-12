import { createHash, randomBytes } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";

export const SESSION_COOKIE_NAME = "markora_session";

export function createOpaqueSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readSessionToken(request: Request): string | undefined {
  const cookieHeader = request.header("cookie");
  if (!cookieHeader) return undefined;
  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    const name = entry.slice(0, separator).trim();
    if (name === SESSION_COOKIE_NAME) return decodeURIComponent(entry.slice(separator + 1));
  }
  return undefined;
}

function cookieOptions(production: boolean, maxAge?: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: production,
    path: "/",
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

export function setSessionCookie(
  response: Response,
  token: string,
  ttlDays: number,
  production: boolean,
): void {
  response.cookie(SESSION_COOKIE_NAME, token, cookieOptions(production, ttlDays * 86_400_000));
}

export function clearSessionCookie(response: Response, production: boolean): void {
  response.clearCookie(SESSION_COOKIE_NAME, cookieOptions(production));
}
