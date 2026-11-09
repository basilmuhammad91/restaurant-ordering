import { createHash, randomBytes } from "node:crypto";
import type { RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import { unscopedDb } from "../db/client.js";
import { unauthenticated } from "../http/errors.js";

// Authentication for the Restoflux team (the platform console). It mirrors staff auth on purpose
// (short access JWT in memory + rotating httpOnly refresh cookie, hashed server-side), but it is a
// SEPARATE system: its own table, its own token audience ("platform") and its own cookie. A restaurant
// token has audience "staff" and is rejected here, and the other way round.
// (Laravel: a second auth guard, e.g. auth:platform.)

const ISSUER = "restoflux";
const AUDIENCE = "platform";
const claimsSchema = z.object({ sub: z.string(), sid: z.string() });

export const PLATFORM_COOKIE = "rf_platform";
const COOKIE_PATH = "/api/v1/platform/auth";
const refreshTtlMs = () => env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface PlatformActor {
  id: string;
  name: string;
  email: string;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      platformUser?: PlatformActor;
    }
  }
}

export function signPlatformToken(input: { platformUserId: string; sessionId: string }): string {
  return jwt.sign({ sid: input.sessionId }, env.JWT_SECRET, {
    subject: input.platformUserId,
    audience: AUDIENCE,
    issuer: ISSUER,
    algorithm: "HS256",
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

function verifyPlatformToken(token: string) {
  try {
    return claimsSchema.parse(jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"], audience: AUDIENCE, issuer: ISSUER }));
  } catch {
    throw unauthenticated("Invalid or expired token");
  }
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => {
  const token = randomBytes(48).toString("base64url");
  return { token, hash: hash(token) };
};

interface ClientMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export async function createPlatformSession(platformUserId: string, meta: ClientMeta) {
  const { token, hash: h } = newToken();
  const session = await unscopedDb.platformSession.create({
    data: {
      platformUserId,
      refreshTokenHash: h,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + refreshTtlMs()),
    },
  });
  return { session, refreshToken: token };
}

export async function rotatePlatformSession(refreshToken: string, meta: ClientMeta) {
  const h = hash(refreshToken);
  const session = await unscopedDb.platformSession.findUnique({ where: { refreshTokenHash: h }, include: { platformUser: { select: { status: true } } } });
  if (!session) {
    const replayed = await unscopedDb.platformSession.findFirst({ where: { prevRefreshTokenHash: h, revokedAt: null } });
    if (replayed) await unscopedDb.platformSession.update({ where: { id: replayed.id }, data: { revokedAt: new Date() } });
    throw unauthenticated("Invalid refresh token");
  }
  if (session.revokedAt || session.expiresAt < new Date() || session.platformUser.status !== "ACTIVE") throw unauthenticated("Session expired");

  const next = newToken();
  const { count } = await unscopedDb.platformSession.updateMany({
    where: { id: session.id, refreshTokenHash: h, revokedAt: null },
    data: {
      refreshTokenHash: next.hash,
      prevRefreshTokenHash: h,
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + refreshTtlMs()),
      ip: meta.ip ?? session.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? session.userAgent,
    },
  });
  if (count === 0) throw unauthenticated("Invalid refresh token");
  return { session, refreshToken: next.token };
}

export const revokePlatformSessionByToken = async (refreshToken: string) => {
  await unscopedDb.platformSession.updateMany({ where: { refreshTokenHash: hash(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
};

export const revokePlatformUserSessions = (platformUserId: string) =>
  unscopedDb.platformSession.updateMany({ where: { platformUserId, revokedAt: null }, data: { revokedAt: new Date() } });

export function setPlatformCookie(res: Response, token: string) {
  res.cookie(PLATFORM_COOKIE, token, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax", path: COOKIE_PATH, maxAge: refreshTtlMs() });
}
export function clearPlatformCookie(res: Response) {
  res.clearCookie(PLATFORM_COOKIE, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax", path: COOKIE_PATH });
}
export function readPlatformCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === PLATFORM_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Middleware for /api/v1/platform/*: valid platform token + live session + active platform user. */
export const authenticatePlatform: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthenticated("Missing bearer token");
  const claims = verifyPlatformToken(header.slice(7));

  const session = await unscopedDb.platformSession.findUnique({
    where: { id: claims.sid },
    select: { platformUserId: true, revokedAt: true, expiresAt: true, platformUser: { select: { id: true, name: true, email: true, status: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.platformUserId !== claims.sub || session.platformUser.status !== "ACTIVE") {
    throw unauthenticated("Session is no longer valid");
  }
  const { id, name, email } = session.platformUser;
  req.platformUser = { id, name, email, sessionId: claims.sid };
  next();
};
