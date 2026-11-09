import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";

const payloadSchema = z.object({
  sub: z.string(),
  role: z.enum(["CUSTOMER", "ADMIN"]),
});
export type AuthUser = { id: number; role: "CUSTOMER" | "ADMIN" };

// JWTs are stateless: the server stores nothing (unlike Laravel sessions or
// Sanctum tokens in a DB table). The signature proves the token is ours.
export function signToken(user: AuthUser): string {
  const options: jwt.SignOptions = {
    subject: String(user.id),
    expiresIn: env.JWT_EXPIRES_IN as NonNullable<jwt.SignOptions["expiresIn"]>,
    algorithm: "HS256",
  };
  return jwt.sign({ role: user.role }, env.JWT_SECRET, options);
}

export function verifyToken(token: string): AuthUser {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
  const p = payloadSchema.parse(decoded);
  return { id: Number(p.sub), role: p.role };
}
