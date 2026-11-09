import type { ErrorCode } from "@restoflux/contracts";

// One error type for everything the API reports on purpose. Throw it anywhere; the error handler
// turns it into { error: { code, message, details, requestId } }.
// (Laravel: like throwing an HttpException / ValidationException handled by the exception Handler.)
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthenticated = (message = "Authentication required") => new AppError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "You do not have permission to do that") => new AppError(403, "FORBIDDEN", message);
/** Not found, also used when the id belongs to another tenant (never reveal that it exists). */
export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, "CONFLICT", message, details);
export const validationError = (message: string, details?: unknown) => new AppError(422, "VALIDATION_ERROR", message, details);
export const approvalRequired = (message: string, details?: unknown) => new AppError(403, "APPROVAL_REQUIRED", message, details);

/** A validation failure attached to one field, in the same shape Zod errors use ({ fieldErrors }). */
export const fieldError = (field: string, message: string) =>
  validationError(message, { formErrors: [], fieldErrors: { [field]: [message] } });
