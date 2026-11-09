import type { RequestHandler } from "express";
import { runWithContext } from "../context/context.js";
import { contextFromPrincipal } from "./context.js";
import { unscopedDb } from "../db/client.js";
import { unauthenticated } from "../http/errors.js";
import { getPrincipal } from "../rbac/principal.js";
import { verifyAccessToken } from "./tokens.js";

/**
 * Authentication middleware for /api/v1:
 *   1. verify the access token (signature, expiry, audience)
 *   2. ONE indexed query: is the session still valid, is the user active, what is the tenant's authVersion
 *   3. load (or reuse from cache) the principal: roles, permissions, limits, locations
 *   4. open the request context so every later database call is scoped to this tenant and these branches
 * (Laravel: the `auth` middleware plus a per-request tenant scope.)
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthenticated("Missing bearer token");
  const claims = verifyAccessToken(header.slice(7));

  const session = await unscopedDb.session.findUnique({
    where: { id: claims.sid },
    select: {
      userId: true,
      tenantId: true,
      revokedAt: true,
      expiresAt: true,
      user: { select: { status: true, deletedAt: true } },
      tenant: { select: { status: true, authVersion: true } },
    },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt < new Date() ||
    session.userId !== claims.sub ||
    session.tenantId !== claims.tid ||
    session.user.status !== "ACTIVE" ||
    session.user.deletedAt ||
    session.tenant.status === "SUSPENDED"
  ) {
    throw unauthenticated("Session is no longer valid");
  }

  const principal = await getPrincipal(session.userId, claims.sid, session.tenant.authVersion);
  req.principal = principal;

  runWithContext(contextFromPrincipal(principal, { requestId: req.requestId, ip: req.ip, userAgent: req.get("user-agent") }), () => next());
};
