import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import { unauthenticated } from "../http/errors.js";

// Access token: short-lived JWT (15 min). It carries identity ONLY: no roles or permissions, so a
// role change applies on the next request instead of when the token expires.
// (Laravel: like a Sanctum token, but self-contained; permissions are looked up server-side per request.)

const claimsSchema = z.object({ sub: z.string(), tid: z.string(), sid: z.string() });
export type AccessClaims = z.infer<typeof claimsSchema>;

const ISSUER = "restoflux";
const AUDIENCE = "staff"; // legacy storefront tokens have no audience, so they can never pass as staff tokens

export function signAccessToken(input: { userId: string; tenantId: string; sessionId: string }): string {
  const options: jwt.SignOptions = {
    subject: input.userId,
    audience: AUDIENCE,
    issuer: ISSUER,
    algorithm: "HS256",
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  };
  return jwt.sign({ tid: input.tenantId, sid: input.sessionId }, env.JWT_SECRET, options);
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"], audience: AUDIENCE, issuer: ISSUER });
    return claimsSchema.parse(payload);
  } catch {
    throw unauthenticated("Invalid or expired token");
  }
}

// Refresh token: 48 random bytes. Only its SHA-256 hash is stored, so a database leak yields nothing usable.
export const hashRefreshToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}
