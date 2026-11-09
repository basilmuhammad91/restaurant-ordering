// The wire format for /api/v1: one success envelope, one error envelope, stable error codes.

export const ERROR_CODES = [
  "VALIDATION_ERROR", // 422
  "UNAUTHENTICATED", // 401
  "FORBIDDEN", // 403 (missing permission or outside your branches' scope for writes)
  "APPROVAL_REQUIRED", // 403 (allowed with a manager's approval)
  "PLAN_LIMIT", // 403 (the organization reached a limit set by the platform team)
  "NOT_FOUND", // 404 (also used for other tenants' ids)
  "CONFLICT", // 409
  "RATE_LIMITED", // 429
  "INTERNAL", // 500
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface OffsetMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface CursorMeta {
  nextCursor: string | null;
}

export interface Envelope<T, M = undefined> {
  data: T;
  meta?: M;
}

export type OffsetList<T> = Envelope<T[], OffsetMeta>;
export type CursorList<T> = Envelope<T[], CursorMeta>;
