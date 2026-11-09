import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";

export const statsRouter = Router();
statsRouter.use(requireAuth, requireRole("ADMIN"));

// "A day" means a day in the restaurant's timezone, not UTC (Pakistan has no DST, so a fixed offset is exact).
const TZ = "Asia/Karachi";
const OFFSET = "+05:00";
const MAX_DAYS = 366;

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const query = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });

const STATUSES = ["PENDING", "CONFIRMED", "PREPARING", "READY", "COMPLETED", "CANCELLED"] as const;
const CHANNELS = ["WEB", "POS", "ANDROID", "IOS"] as const;

// Definitions used below:
//  - total orders / status counts / channels / daily orders: every order in range (cancelled included)
//  - sales, average order value, top items: non-cancelled orders only
//  - cancelled rate: cancelled / total orders (0..1)
statsRouter.get("/", async (req, res) => {
  const q = query.parse(req.query);
  const to = q.to ?? dayKey(new Date());
  const from = q.from ?? addDays(to, -29); // default: last 30 days including today
  if (from > to) throw new HttpError(422, "'from' must not be after 'to'");
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push(d);
    if (days.length > MAX_DAYS) throw new HttpError(422, `Range cannot exceed ${MAX_DAYS} days`);
  }

  const orders = await prisma.legacyOrder.findMany({
    where: {
      createdAt: { gte: new Date(`${from}T00:00:00.000${OFFSET}`), lte: new Date(`${to}T23:59:59.999${OFFSET}`) },
    },
    select: {
      status: true,
      channel: true,
      totalCents: true,
      createdAt: true,
      items: { select: { quantity: true, menuItem: { select: { id: true, name: true } } } },
      deals: {
        select: {
          quantity: true,
          deal: { select: { items: { select: { quantity: true, menuItem: { select: { id: true, name: true } } } } } },
        },
      },
    },
  });

  const statuses = Object.fromEntries(STATUSES.map((s) => [s, { count: 0, amountCents: 0 }])) as Record<
    (typeof STATUSES)[number],
    { count: number; amountCents: number }
  >;
  const channels = Object.fromEntries(CHANNELS.map((c) => [c, 0])) as Record<(typeof CHANNELS)[number], number>;
  const daily = new Map(days.map((d) => [d, { date: d, orders: 0, salesCents: 0 }]));
  const sold = new Map<number, { menuItemId: number; name: string; quantity: number }>();
  const addSold = (m: { id: number; name: string }, n: number) => {
    const row = sold.get(m.id) ?? { menuItemId: m.id, name: m.name, quantity: 0 };
    row.quantity += n;
    sold.set(m.id, row);
  };

  let salesCents = 0;
  let soldOrders = 0;
  for (const o of orders) {
    statuses[o.status].count++;
    statuses[o.status].amountCents += o.totalCents;
    channels[o.channel]++;
    const day = daily.get(dayKey(o.createdAt));
    if (day) day.orders++;
    if (o.status === "CANCELLED") continue;

    salesCents += o.totalCents;
    soldOrders++;
    if (day) day.salesCents += o.totalCents;
    for (const i of o.items) addSold(i.menuItem, i.quantity);
    for (const d of o.deals) for (const part of d.deal.items) addSold(part.menuItem, part.quantity * d.quantity);
  }

  res.json({
    range: { from, to, timezone: TZ },
    statuses,
    kpis: {
      totalOrders: orders.length,
      totalSalesCents: salesCents,
      averageOrderValueCents: soldOrders ? Math.round(salesCents / soldOrders) : 0,
      cancelledRate: orders.length ? Math.round((statuses.CANCELLED.count / orders.length) * 10000) / 10000 : 0,
    },
    channels: CHANNELS.map((channel) => ({ channel, count: channels[channel] })),
    daily: [...daily.values()],
    topItems: [...sold.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)).slice(0, 5),
  });
});
