import type { Request } from "express";
import { unscopedDb } from "../db/client.js";
import { sanitize } from "../audit/audit.js";

/** Append an entry to the platform audit log: who on the Restoflux team did what to which organization. */
export async function recordPlatformAudit(
  req: Request,
  entry: { action: string; entityType: string; entityId: string; tenantId?: string | null; before?: unknown; after?: unknown; reason?: string | undefined },
): Promise<void> {
  await unscopedDb.platformAuditLog.create({
    data: {
      platformUserId: req.platformUser?.id ?? null,
      tenantId: entry.tenantId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before === undefined ? undefined : (sanitize(entry.before) as never),
      after: entry.after === undefined ? undefined : (sanitize(entry.after) as never),
      reason: entry.reason ?? null,
      requestId: req.requestId,
      ip: req.ip ?? null,
    },
  });
}
