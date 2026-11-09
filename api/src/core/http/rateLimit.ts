import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

// A small fixed-window, in-memory rate limiter for sensitive endpoints (login, refresh, PIN override).
// In-memory means per server instance; on serverless that still blunts brute force, and a shared store
// (Upstash Redis) can replace `hits` later without changing callers. Disabled in tests.
// (Laravel: like the `throttle:` middleware.)

const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(opts: { name: string; max: number; windowMs: number; key?: (req: Parameters<RequestHandler>[0]) => string }): RequestHandler {
  return (req, res, next) => {
    if (env.NODE_ENV === "test") return next();
    const key = `${opts.name}:${opts.key ? opts.key(req) : req.ip}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > opts.max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      throw new AppError(429, "RATE_LIMITED", "Too many attempts. Please wait and try again.");
    }
    next();
  };
}
