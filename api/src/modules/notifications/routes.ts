import { cursorQuerySchema, idSchema } from "@restoflux/contracts";
import { z } from "zod";
import { db } from "../../core/db/scoped.js";
import { notFound } from "../../core/http/errors.js";
import { afterCursor, encodeCursor } from "../../core/http/pagination.js";
import { securedRouter } from "../../core/http/secured.js";
import type { Principal } from "../../core/rbac/principal.js";

// NOTIFICATIONS: the in-app inbox (bell icon). A notification is for a specific user, or for everyone
// who holds a given permission within the notification's branch (e.g. "approval needed" reaches the
// managers of that branch). Branch scoping comes from the scoped client.
// Known limit (Phase 1): "read" is stored once per notification, so a broadcast notification marked
// read by one manager is read for all; per-user receipts can be added later.

const { router, get, post } = securedRouter("/api/v1/notifications");

function visibleTo(p: Principal) {
  return {
    OR: [
      { userId: p.userId },
      { userId: null, requiredPermission: null },
      { userId: null, requiredPermission: { in: [...p.permissions] } },
    ],
  };
}

/** Alert types this person switched off in Settings > Notifications. */
async function mutedTypes(p: Principal): Promise<string[]> {
  const rows = await db.notificationPreference.findMany({ where: { userId: p.userId, inApp: false }, select: { type: true } });
  return rows.map((r) => r.type);
}

get("/", "authenticated", async (req, res) => {
  const p = req.principal!;
  const muted = await mutedTypes(p);
  const q = cursorQuerySchema.extend({ unread: z.enum(["true", "false"]).transform((v) => v === "true").optional() }).parse(req.query);

  const and: Record<string, unknown>[] = [visibleTo(p), ...(muted.length ? [{ type: { notIn: muted } }] : [])];
  const cursor = afterCursor("createdAt", q.cursor);
  if (cursor) and.push(cursor);
  if (q.unread) and.push({ readAt: null });

  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({ where: { AND: and }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: q.limit + 1 }),
    db.notification.count({ where: { AND: [...and.slice(0, 1 + (muted.length ? 1 : 0)), { readAt: null }] } }),
  ]);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  res.json({ data: page, meta: { nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null, unreadCount } });
});

post("/read-all", "authenticated", async (req, res) => {
  const { count } = await db.notification.updateMany({ where: { AND: [visibleTo(req.principal!), { readAt: null }] }, data: { readAt: new Date() } });
  res.json({ data: { updated: count } });
});

post("/:id/read", "authenticated", async (req, res) => {
  const { id } = z.object({ id: idSchema }).parse(req.params);
  const { count } = await db.notification.updateMany({ where: { AND: [{ id }, visibleTo(req.principal!)] }, data: { readAt: new Date() } });
  if (count === 0) throw notFound("notification");
  res.status(204).end();
});

export const notificationsRouter = router;
