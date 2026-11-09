import type { RequestHandler } from "express";
import { verifyToken } from "../lib/jwt.js";
import { HttpError } from "./error.js";

// Equivalent of Laravel's `auth:sanctum` middleware.
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Missing bearer token");
  try {
    req.user = verifyToken(header.slice(7));
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
  next();
};

// Equivalent of a role gate/middleware: use after requireAuth.
export const requireRole =
  (...roles: Array<"CUSTOMER" | "ADMIN">): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw new HttpError(403, "Forbidden");
    next();
  };
