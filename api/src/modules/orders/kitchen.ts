import { idSchema, kitchenQuerySchema, lineStatusInputSchema, formatOrderNumber, type OrderStatus } from "@restoflux/contracts";
import { z } from "zod";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext } from "../../core/context/context.js";
import { db, type Tx } from "../../core/db/scoped.js";
import { notFound } from "../../core/http/errors.js";
import { securedRouter } from "../../core/http/secured.js";
import { conflictError } from "./shared.js";

// THE KITCHEN DISPLAY (KDS). Tickets are the orders the kitchen has been sent and has not finished;
// each ticket lists its lines for one station (grill, fryer, bar). Cooks "bump" a line as it starts and
// finishes, and the order moves to PREPARING and READY by itself when its lines do.

const kds = securedRouter("/api/v1/kds");

/** After a line changes, move its order forward when every active line has caught up. */
async function syncOrderFromLines(tx: Tx, orderId: string) {
  const order = await tx.order.findFirst({ where: { id: orderId } });
  if (!order || (order.status !== "CONFIRMED" && order.status !== "PREPARING")) return;
  const lines = await tx.orderLine.findMany({ where: { orderId, status: { not: "VOIDED" }, kind: { not: "COMBO" } } });
  if (lines.length === 0) return;
  const from = order.status as OrderStatus;
  const userId = requireContext().userId;
  const event = (to: OrderStatus) => tx.orderStatusEvent.create({ data: { tenantId: requireContext().tenantId, orderId, fromStatus: from, toStatus: to, byUserId: userId } });

  if (lines.every((l) => l.status === "READY" || l.status === "SERVED")) {
    await tx.order.update({ where: { id: orderId }, data: { status: "READY" } });
    await tx.orderLine.updateMany({ where: { orderId, kind: "COMBO", status: { not: "VOIDED" } }, data: { status: "READY", readyAt: new Date() } });
    await event("READY");
  } else if (from === "CONFIRMED" && lines.some((l) => l.status === "PREPARING" || l.status === "READY")) {
    await tx.order.update({ where: { id: orderId }, data: { status: "PREPARING" } });
    await event("PREPARING");
  }
}

kds.get("/", "kds.access", async (req, res) => {
  const q = kitchenQuerySchema.parse(req.query);
  const orders = await db.order.findMany({
    where: { locationId: q.locationId, status: { in: ["CONFIRMED", "PREPARING"] } },
    orderBy: { placedAt: "asc" },
    include: {
      location: { select: { orderPrefix: true } },
      lines: { where: { status: { not: "VOIDED" } }, orderBy: { sortOrder: "asc" }, include: { modifiers: true } },
    },
    take: 100,
  });
  const tableIds = [...new Set(orders.map((o) => o.tableId).filter((x): x is string => !!x))];
  const tables = tableIds.length ? await db.diningTable.findMany({ where: { id: { in: tableIds } }, select: { id: true, name: true } }) : [];
  const tableName = new Map(tables.map((t) => [t.id, t.name]));

  const tickets = orders.flatMap((o) => {
    const byId = new Map(o.lines.map((l) => [l.id, l]));
    // a combo header is only a label; its parts are what gets cooked, each on its own station
    const cookable = o.lines.filter((l) => l.kind !== "COMBO" && l.status !== "SERVED");
    const mine = q.station ? cookable.filter((l) => l.stationKey === q.station) : cookable;
    if (mine.length === 0 || mine.every((l) => l.status === "READY")) return [];
    return [{
      orderId: o.id, orderNumber: formatOrderNumber(o.location.orderPrefix, o.displayNumber), orderType: o.orderType, channel: o.channel, status: o.status,
      table: o.tableId ? tableName.get(o.tableId) ?? null : null, customerName: o.customerName, notes: o.notes, placedAt: o.placedAt, sentAt: o.placedAt,
      lines: mine.map((l) => ({
        id: l.id, name: l.nameSnapshot, variantName: l.variantNameSnapshot, quantity: l.quantity, notes: l.notes, status: l.status, stationKey: l.stationKey,
        partOf: l.parentLineId ? byId.get(l.parentLineId)?.nameSnapshot ?? null : null, modifiers: l.modifiers.map((m) => m.nameSnapshot),
      })),
    }];
  });
  res.json({ data: tickets });
});

const NEXT: Record<string, string[]> = { NEW: ["PREPARING", "READY"], PREPARING: ["READY"], READY: ["SERVED"] };

kds.patch("/lines/:id", "kds.access", async (req, res) => {
  const { id } = z.object({ id: idSchema }).parse(req.params);
  const { status } = lineStatusInputSchema.parse(req.body);
  const result = await db.$transaction(async (tx) => {
    const line = await tx.orderLine.findFirst({ where: { id } });
    if (!line) throw notFound("order line");
    if (!(NEXT[line.status] ?? []).includes(status)) throw conflictError(`A ${line.status.toLowerCase()} item cannot become ${status.toLowerCase()}`);
    const order = await tx.order.findFirst({ where: { id: line.orderId } });
    if (!order || (order.status !== "CONFIRMED" && order.status !== "PREPARING" && order.status !== "READY")) throw conflictError("This order is not in the kitchen");
    await tx.orderLine.update({ where: { id }, data: { status, ...(status === "READY" ? { readyAt: new Date() } : {}) } });
    await syncOrderFromLines(tx, line.orderId);
    return tx.order.findFirstOrThrow({ where: { id: line.orderId }, select: { id: true, status: true } });
  });
  res.json({ data: { lineId: id, lineStatus: status, orderId: result.id, orderStatus: result.status } });
});

/** "Bump" a whole ticket: every item (at this station) is ready. */
kds.post("/orders/:id/ready", "kds.access", async (req, res) => {
  const { id } = z.object({ id: idSchema }).parse(req.params);
  const { station } = z.object({ station: z.string().trim().toUpperCase().max(30).optional() }).parse(req.body ?? {});
  const order = await db.$transaction(async (tx) => {
    const found = await tx.order.findFirst({ where: { id } });
    if (!found) throw notFound("order");
    if (found.status !== "CONFIRMED" && found.status !== "PREPARING") throw conflictError("This order is not in the kitchen");
    await tx.orderLine.updateMany({ where: { orderId: id, kind: { not: "COMBO" }, status: { in: ["NEW", "PREPARING"] }, ...(station ? { stationKey: station } : {}) }, data: { status: "READY", readyAt: new Date() } });
    await syncOrderFromLines(tx, id);
    await recordAudit(tx, { action: "kds.bump", entityType: "Order", entityId: id, locationId: found.locationId, after: { station: station ?? "ALL" } });
    return tx.order.findFirstOrThrow({ where: { id }, select: { id: true, status: true } });
  });
  res.json({ data: { orderId: order.id, orderStatus: order.status } });
});

export const kitchenRouter = kds.router;
