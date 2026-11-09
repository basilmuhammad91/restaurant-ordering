import { cursorQuerySchema, idSchema } from "@restoflux/contracts";
import { z } from "zod";
import { withArchived } from "../../core/context/context.js";
import { db } from "../../core/db/scoped.js";
import { afterCursor, encodeCursor } from "../../core/http/pagination.js";
import { securedRouter } from "../../core/http/secured.js";

// AUDIT LOG viewer: read-only, newest first, cursor pagination (the log is large and append-only).
// Users limited to some branches only see entries of those branches (the scoped client enforces it).

const { router, get } = securedRouter("/api/v1/audit-logs");

const filterSchema = cursorQuerySchema.extend({
  actorUserId: idSchema.optional(),
  action: z.string().trim().max(80).optional(), // exact, e.g. users.create
  actionPrefix: z.string().trim().max(80).optional(), // e.g. users. or roles.
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(80).optional(),
  locationId: idSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

get("/", "audit.view", async (req, res) => {
  const q = filterSchema.parse(req.query);

  const and: Record<string, unknown>[] = [];
  const cursor = afterCursor("occurredAt", q.cursor);
  if (cursor) and.push(cursor);
  if (q.from || q.to) and.push({ occurredAt: { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) } });

  const where = {
    ...(q.actorUserId && { actorUserId: q.actorUserId }),
    ...(q.action && { action: q.action }),
    ...(q.actionPrefix && { action: { startsWith: q.actionPrefix } }),
    ...(q.entityType && { entityType: q.entityType }),
    ...(q.entityId && { entityId: q.entityId }),
    ...(q.locationId && { locationId: q.locationId }),
    ...(and.length && { AND: and }),
  };

  const rows = await db.auditLog.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: q.limit + 1 });
  const page = rows.slice(0, q.limit);

  // Attach actor names (the log keeps only the id, so it survives user deletion).
  const actorIds = [...new Set(page.map((r) => r.actorUserId).filter((x): x is string => !!x))];
  const actors = actorIds.length
    ? await withArchived(() => db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }))
    : [];
  const byId = new Map(actors.map((a) => [a.id, a]));

  const last = page.at(-1);
  res.json({
    data: page.map((r) => ({ ...r, actor: r.actorUserId ? byId.get(r.actorUserId) ?? null : null })),
    meta: { nextCursor: rows.length > q.limit && last ? encodeCursor(last.occurredAt, last.id) : null },
  });
});

export const auditRouter = router;
