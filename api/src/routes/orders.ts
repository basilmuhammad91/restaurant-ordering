import type { OrderStatus } from "../generated/prisma/client.js";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";

export const ordersRouter = Router();
ordersRouter.use(requireAuth); // every order route needs a logged-in user

const idParam = z.object({ id: z.coerce.number().int().positive() });

const createBody = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(50),
      }),
    )
    .min(1)
    .max(50),
  notes: z.string().trim().max(500).optional(),
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
} as const;

// Customers only ever see their own orders; admins see everything.
// A customer asking for someone else's order gets 404, not 403, so ids don't leak.
function scope(user: { id: number; role: string }) {
  return user.role === "ADMIN" ? {} : { userId: user.id };
}

ordersRouter.post("/", async (req, res) => {
  const { items, notes } = createBody.parse(req.body);

  // Merge duplicate lines of the same item.
  const qty = new Map<number, number>();
  for (const i of items) qty.set(i.menuItemId, (qty.get(i.menuItemId) ?? 0) + i.quantity);

  const menuItems = await prisma.menuItem.findMany({ where: { id: { in: [...qty.keys()] } } });
  if (menuItems.length !== qty.size) throw new HttpError(422, "One or more menu items do not exist");
  if (menuItems.some((m) => !m.available)) throw new HttpError(422, "One or more menu items are unavailable");

  // Prices are read from the DB, never trusted from the client.
  const lines = menuItems.map((m) => ({
    menuItemId: m.id,
    quantity: qty.get(m.id)!,
    unitPriceCents: m.priceCents,
  }));
  const totalCents = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);

  // A nested create runs as one transaction: order and lines both save, or neither does.
  const order = await prisma.order.create({
    data: { userId: req.user!.id, totalCents, notes: notes || null, items: { create: lines } },
    include,
  });
  res.status(201).json({ data: order });
});

ordersRouter.get("/", async (req, res) => {
  const { status, page, limit } = listQuery.parse(req.query);
  const where = { ...scope(req.user!), ...(status && { status }) };
  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);
  res.json({ data: orders, meta: { page, limit, total } });
});

ordersRouter.get("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const order = await prisma.order.findFirst({ where: { id, ...scope(req.user!) }, include });
  if (!order) throw new HttpError(404, "Not found");
  res.json({ data: order });
});

// Compare-and-set: the UPDATE only matches if the status is still what we read,
// so two concurrent requests can't both apply a transition.
async function changeStatus(id: number, from: OrderStatus, to: OrderStatus) {
  const { count } = await prisma.order.updateMany({ where: { id, status: from }, data: { status: to } });
  if (count === 0) throw new HttpError(409, "Order status changed, please retry");
  return prisma.order.findUniqueOrThrow({ where: { id }, include });
}

ordersRouter.patch("/:id/status", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { status } = z.object({ status: listQuery.shape.status.unwrap() }).parse(req.body);

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new HttpError(404, "Not found");
  if (!transitions[order.status].includes(status)) {
    throw new HttpError(409, `Cannot change status from ${order.status} to ${status}`);
  }
  res.json({ data: await changeStatus(id, order.status, status) });
});

// Customers can cancel their own order, but only while it is still PENDING.
ordersRouter.post("/:id/cancel", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const order = await prisma.order.findFirst({ where: { id, ...scope(req.user!) } });
  if (!order) throw new HttpError(404, "Not found");
  if (req.user!.role !== "ADMIN" && order.status !== "PENDING") {
    throw new HttpError(409, "Only pending orders can be cancelled");
  }
  if (!transitions[order.status].includes("CANCELLED")) {
    throw new HttpError(409, `Cannot cancel an order that is ${order.status}`);
  }
  res.json({ data: await changeStatus(id, order.status, "CANCELLED") });
});
