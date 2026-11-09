import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError, z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found" });
};

// Equivalent of Laravel's exception Handler. Express 5 forwards errors thrown
// in async handlers here automatically.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(422).json({ error: "Validation failed", details: z.flattenError(err).fieldErrors });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Prisma known errors, identified by code (like catching QueryException in Laravel):
  // P2002 unique violation, P2003 foreign key violation, P2025 record not found.
  const code = typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
  if (code === "P2002") {
    res.status(409).json({ error: "Already exists" });
    return;
  }
  if (code === "P2003") {
    res.status(409).json({ error: "Conflict: record is referenced by other data" });
    return;
  }
  if (code === "P2025") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
