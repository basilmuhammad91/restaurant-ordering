import { randomUUID } from "node:crypto";
import type { ErrorCode } from "@restoflux/contracts";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError, z } from "zod";
import { AppError } from "./errors.js";

/** Gives every request an id (echoed in the X-Request-Id header and in error bodies and audit rows). */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.get("x-request-id");
  req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

export const v1NotFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found", requestId: req.requestId } });
};

function prismaCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && /^P\d{4}$/.test(code) ? code : undefined;
}

/** Turns anything thrown under /api/v1 into the documented error envelope. (Laravel: the exception Handler.) */
export const v1ErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.requestId;
  const send = (status: number, code: ErrorCode, message: string, details?: unknown) =>
    res.status(status).json({ error: { code, message, ...(details !== undefined && { details }), requestId } });

  if (err instanceof AppError) return void send(err.status, err.code, err.message, err.details);
  if (err instanceof ZodError) return void send(422, "VALIDATION_ERROR", "Validation failed", z.flattenError(err));
  if ((err as { type?: string })?.type === "entity.parse.failed") return void send(422, "VALIDATION_ERROR", "Request body is not valid JSON");

  switch (prismaCode(err)) {
    case "P2002": return void send(409, "CONFLICT", "A record with the same unique value already exists");
    case "P2003": return void send(409, "CONFLICT", "The record is referenced by other data, or references something that does not exist");
    case "P2025": return void send(404, "NOT_FOUND", "Resource not found");
  }

  console.error(`[${requestId}]`, err);
  send(500, "INTERNAL", "Internal server error");
};
