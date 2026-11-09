import type { OrderStatus } from "../../generated/prisma/client.js";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { activeDealWhere } from "./deals.js";

export const ordersRouter = Router();
ordersRouter.use(requireAuth); // every order route needs a logged-in user

const idParam = z.object({ id: z.coerce.number().int().positive() });

const createBody = z
  .object({
    items: z
      .array(z.object({ menuItemId: z.number().int().positive(), quantity: z.number().int().min(1).max(50) }))
      .max(50)
      .default([]),
    deals: z
      .array(z.object({ dealId: z.number().int().positive(), quantity: z.number().int().min(1).max(20) }))
      .max(20)
      .default([]),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((b) => b.items.length + b.deals.length > 0, {
    path: ["items"],
    message: "An order needs at least one item or deal",
  });

const listQuery = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "PREPARING", "READY", "COMPLETED", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// The order lifecycle as a state machine: which statuses may follow which.
const transitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY"],
  READY: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

const include = {
  user: { select: { id: true, name: true, email: true } },
  items: { include: { menuItem: { select: { id: true, name: true } } } },
  deals: true,
} as const;

// Customers only ever see their own orders; admins see everything.
// A customer asking for someone else's order gets 404, not 403, so ids don't leak.
function scope(user: { id: number; role: string }) {
  return user.role === "ADMIN" ? {} : { userId: user.id };
}

ordersRouter.post("/", async (req, res) => {
  const { items, deals, notes } = createBody.parse(req.body);

  // Merge duplicate lines of the same item / deal.
  const qty = new Map<number, number>();
  for (const i of items) qty.set(i.menuItemId, (qty.get(i.menuItemId) ?? 0) + i.quantity);
  const dealQty = new Map<number, number>();
  for (const d of deals) dealQty.set(d.dealId, (dealQty.get(d.dealId) ?? 0) + d.quantity);

  const menuItems = await prisma.legacyMenuItem.findMany({ where: { id: { in: [...qty.keys()] } } });
  if (menuItems.length !== qty.size) throw new HttpError(422, "One or more menu items do not exist");
  if (menuItems.some((m) => !m.available)) throw new HttpError(422, "One or more menu items are unavailable");

  // Deals must be switched on, inside their schedule, and have every part in stock.
  const dealRows = await prisma.legacyDeal.findMany({
    where: { id: { in: [...dealQty.keys()] }, ...activeDealWhere() },
    include: { items: { include: { menuItem: { select: { available: true } } } } },
  });
  if (dealRows.length !== dealQty.size) throw new HttpError(422, "One or more deals do not exist or are no longer active");
  const brokenDeal = dealRows.find((d) => d.items.some((i) => !i.menuItem.available));
  if (brokenDeal) throw new HttpError(422, `"${brokenDeal.name}" is unavailable right now`);

  // Prices are read from the DB, never trusted from the client.
  const lines = menuItems.map((m) => ({
    menuItemId: m.id,
    quantity: qty.get(m.id)!,
    unitPriceCents: m.priceCents,
  }));
  const dealLines = dealRows.map((d) => ({
    dealId: d.id,
    dealName: d.name, // snapshots: later edits to the deal never rewrite history
    quantity: dealQty.get(d.id)!,
    unitPriceCents: d.dealPriceCents,
  }));
  const totalCents =
    lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0) +
    dealLines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);

  // A nested create runs as one transaction: order and lines both save, or neither does.
  const order = await prisma.legacyOrder.create({
    data: {
      userId: req.user!.id,
      totalCents,
      notes: notes || null,
      items: { create: lines },
      deals: { create: dealLines },
    },
    include,
  });
  res.status(201).json({ data: order });
});

ordersRouter.get("/", async (req, res) => {
  const { status, page, limit } = listQuery.parse(req.query);
  const where = { ...scope(req.user!), ...(status && { status }) };
  const [orders, total] = await Promise.all([
    prisma.legacyOrder.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.legacyOrder.count({ where }),
  ]);
  res.json({ data: orders, meta: { page, limit, total } });
});

ordersRouter.get("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const order = await prisma.legacyOrder.findFirst({ where: { id, ...scope(req.user!) }, include });
  if (!order) throw new HttpError(404, "Not found");
  res.json({ data: order });
});

// Compare-and-set: the UPDATE only matches if the status is still what we read,
// so two concurrent requests can't both apply a transition.
async function changeStatus(id: number, from: OrderStatus, to: OrderStatus) {
  const { count } = await prisma.legacyOrder.updateMany({ where: { id, status: from }, data: { status: to } });
  if (count === 0) throw new HttpError(409, "Order status changed, please retry");
  return prisma.legacyOrder.findUniqueOrThrow({ where: { id }, include });
}

ordersRouter.patch("/:id/status", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { status } = z.object({ status: listQuery.shape.status.unwrap() }).parse(req.body);

  const order = await prisma.legacyOrder.findUnique({ where: { id } });
  if (!order) throw new HttpError(404, "Not found");
  if (!transitions[order.status].includes(status)) {
    throw new HttpError(409, `Cannot change status from ${order.status} to ${status}`);
  }
  res.json({ data: await changeStatus(id, order.status, status) });
});

// Customers can cancel their own order, but only while it is still PENDING.
ordersRouter.post("/:id/cancel", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const order = await prisma.legacyOrder.findFirst({ where: { id, ...scope(req.user!) } });
  if (!order) throw new HttpError(404, "Not found");
  if (req.user!.role !== "ADMIN" && order.status !== "PENDING") {
    throw new HttpError(409, "Only pending orders can be cancelled");
  }
  if (!transitions[order.status].includes("CANCELLED")) {
    throw new HttpError(409, `Cannot cancel an order that is ${order.status}`);
  }
  res.json({ data: await changeStatus(id, order.status, "CANCELLED") });
});
