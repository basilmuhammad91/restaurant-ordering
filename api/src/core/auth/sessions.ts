import type { Response } from "express";
import { env } from "../config/env.js";
import { unscopedDb } from "../db/client.js";
import { unauthenticated } from "../http/errors.js";
import { hashRefreshToken, newRefreshToken } from "./tokens.js";

// Server-side sessions behind the short-lived access token. They make logout, "sign out everywhere"
// and user deactivation real (a JWT alone cannot be revoked). The refresh token rotates on every use;
// presenting an already-rotated token means it was stolen and replayed, so the whole session is revoked.

export const REFRESH_COOKIE = "rf_refresh";
const REFRESH_PATH = "/api/v1/auth";
const refreshTtlMs = () => env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

interface ClientMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export async function createSession(input: { userId: string; tenantId: string } & ClientMeta) {
  const { token, hash } = newRefreshToken();
  const session = await unscopedDb.session.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      audience: "STAFF",
      refreshTokenHash: hash,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + refreshTtlMs()),
    },
  });
  return { session, refreshToken: token };
}

/** Exchange a refresh token for a new one (rotation). Throws 401 for anything invalid. */
export async function rotateSession(refreshToken: string, meta: ClientMeta) {
  const hash = hashRefreshToken(refreshToken);
  const session = await unscopedDb.session.findUnique({
    where: { refreshTokenHash: hash },
    include: { user: { select: { status: true, deletedAt: true } }, tenant: { select: { status: true } } },
  });

  if (!session) {
    // Maybe an already-rotated token: replay detection.
    const replayed = await unscopedDb.session.findFirst({ where: { prevRefreshTokenHash: hash, revokedAt: null } });
    if (replayed) await unscopedDb.session.update({ where: { id: replayed.id }, data: { revokedAt: new Date() } });
    throw unauthenticated("Invalid refresh token");
  }
  if (session.revokedAt || session.expiresAt < new Date()) throw unauthenticated("Session expired");
  if (session.user.status !== "ACTIVE" || session.user.deletedAt || session.tenant.status === "SUSPENDED") {
    throw unauthenticated("Account is not active");
  }

  const next = newRefreshToken();
  // Compare-and-set: two parallel refreshes cannot both rotate the same token.
  const { count } = await unscopedDb.session.updateMany({
    where: { id: session.id, refreshTokenHash: hash, revokedAt: null },
    data: {
      refreshTokenHash: next.hash,
      prevRefreshTokenHash: hash,
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + refreshTtlMs()),
      ip: meta.ip ?? session.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? session.userAgent,
    },
  });
  if (count === 0) throw unauthenticated("Invalid refresh token");
  return { session, refreshToken: next.token };
}

export const revokeSession = (sessionId: string) =>
  unscopedDb.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });

export const revokeUserSessions = (userId: string) =>
  unscopedDb.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });

// ---- the refresh cookie ----

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true, // JavaScript cannot read it, so XSS cannot steal it
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: REFRESH_PATH,
    maxAge: refreshTtlMs(),
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax", path: REFRESH_PATH });
}

export function readRefreshCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === REFRESH_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}
