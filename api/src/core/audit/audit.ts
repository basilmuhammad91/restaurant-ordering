import { requireContext } from "../context/context.js";
import type { Db } from "../db/scoped.js";

// The audit trail: who did what, when, in which branch, with before/after values.
// Services call recordAudit() INSIDE the same transaction as the change, so a change and its audit
// record commit or roll back together (a change can never exist without its record).
// Explicit calls (not automatic model hooks) keep each record meaningful and testable (Decision D12).
// (Laravel: like spatie/laravel-activitylog, written explicitly.)

/** Works with the scoped client or a transaction handle from `db.$transaction`. */
export type AuditClient = { auditLog: Db["auditLog"] };

export interface AuditEntry {
  /** "module.action", e.g. "users.create", "roles.permissions.update", "orders.void" */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null | undefined;
  locationId?: string | null | undefined;
}

const REDACTED_KEYS = new Set([
  "passwordHash", "posPinHash", "refreshTokenHash", "prevRefreshTokenHash", "password", "pin", "token", "accessToken", "refreshToken",
]);

/** JSON-safe deep copy (Dates, Decimals become strings) with secrets removed. */
export function sanitize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value, (key, v) => (REDACTED_KEYS.has(key) ? "[redacted]" : v)));
}

export async function recordAudit(client: AuditClient, entry: AuditEntry): Promise<void> {
  const ctx = requireContext();
  await client.auditLog.create({
    data: {
      tenantId: ctx.tenantId, // stamped again by the scoped client; explicit here for type completeness
      locationId: entry.locationId ?? null,
      actorUserId: ctx.userId,
      actorType: ctx.actorType,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: (sanitize(entry.before) ?? undefined) as never,
      after: (sanitize(entry.after) ?? undefined) as never,
      reason: entry.reason ?? null,
      requestId: ctx.requestId,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent?.slice(0, 300) ?? null,
    },
  });
}
