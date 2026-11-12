import { reportQuerySchema } from "@restoflux/contracts";
import { db } from "../../core/db/scoped.js";
import { securedRouter } from "../../core/http/secured.js";
import { buildSalesSummary } from "../orders/sales.js";
import { soldItems } from "./routes.js";

// EXTRA DASHBOARD NUMBERS: how this period compares with the one before it, the busiest hours, the best sellers,
// the latest orders, and a short list of things that need someone's attention. Each block is only included when
// the signed-in person holds the permission that would let them open the matching screen.

const dash = securedRouter("/api/v1/dashboard");
const asDate = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

dash.get("/insights", "dashboard.view", async (req, res) => {
  const q = reportQuerySchema.parse(req.query);
  const p = req.principal!;
  const has = (k: string) => p.permissions.has(k);
  const financial = has("dashboard.financial.view");

  const currency = q.currencyCode ?? (await db.tenant.findFirst({ select: { baseCurrency: true } }))?.baseCurrency ?? "USD";
  const locations = await db.location.findMany({ where: { currencyCode: currency, type: "BRANCH", ...(q.locationIds?.length && { id: { in: q.locationIds } }), ...(q.brandId && { brandId: q.brandId }) }, select: { id: true, timezone: true } });
  const locationIds = locations.map((l) => l.id);
  const zone = new Map(locations.map((l) => [l.id, l.timezone]));
  const out: Record<string, unknown> = { currencyCode: currency };
  if (locationIds.length === 0) return res.json({ data: out });

  const span = Math.round((asDate(q.to).getTime() - asDate(q.from).getTime()) / 86_400_000) + 1;
  const prevTo = isoDay(new Date(asDate(q.from).getTime() - 86_400_000));
  const prevFrom = isoDay(new Date(asDate(q.from).getTime() - span * 86_400_000));
  const scope = { locationIds, ...(q.brandId && { brandId: q.brandId }) };

  // ---- this period against the one just before it
  if (financial) {
    const [now, before] = await Promise.all([buildSalesSummary({ ...scope, from: q.from, to: q.to }), buildSalesSummary({ ...scope, from: prevFrom, to: prevTo })]);
    const a = now.find((s) => s.currencyCode === currency), b = before.find((s) => s.currencyCode === currency);
    out.compare = { previousFrom: prevFrom, previousTo: prevTo, previousNetSalesMinor: b?.netSalesMinor ?? 0, previousOrders: b?.orders ?? 0, netSalesMinor: a?.netSalesMinor ?? 0, orders: a?.orders ?? 0 };
  }

  // ---- busiest hours (the branch's own clock) and the latest orders
  const orders = await db.order.findMany({
    where: { locationId: { in: locationIds }, currencyCode: currency, businessDate: { gte: asDate(q.from), lte: asDate(q.to) }, status: { notIn: ["OPEN", "CANCELLED"] } },
    select: { id: true, displayNumber: true, occurredAt: true, totalMinor: true, status: true, orderType: true, locationId: true, location: { select: { name: true, orderPrefix: true } } },
    orderBy: { occurredAt: "desc" }, take: 3000,
  });
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, totalMinor: 0 }));
  for (const o of orders) {
    const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: zone.get(o.locationId) ?? "UTC", hour: "2-digit", hourCycle: "h23" }).format(o.occurredAt));
    hours[h]!.orders++; hours[h]!.totalMinor += o.totalMinor;
  }
  out.hours = financial ? hours : hours.map((h) => ({ ...h, totalMinor: 0 }));
  if (financial) {
    const perBranch = new Map<string, { name: string; orders: number; totalMinor: number }>();
    const weekdays = Array.from({ length: 7 }, (_, i) => ({ day: i, orders: 0, totalMinor: 0 })); // 0 = Monday
    for (const o of orders) {
      const b = perBranch.get(o.locationId) ?? { name: o.location.name, orders: 0, totalMinor: 0 };
      b.orders++; b.totalMinor += o.totalMinor; perBranch.set(o.locationId, b);
      const name = new Intl.DateTimeFormat("en-GB", { timeZone: zone.get(o.locationId) ?? "UTC", weekday: "short" }).format(o.occurredAt);
      const d = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(name);
      if (d >= 0) { weekdays[d]!.orders++; weekdays[d]!.totalMinor += o.totalMinor; }
    }
    out.branches = [...perBranch.values()].sort((a, b) => b.totalMinor - a.totalMinor);
    out.weekdays = weekdays;
  }
  if (has("orders.view")) {
    out.recentOrders = orders.slice(0, 6).map((o) => ({ id: o.id, number: `${o.location.orderPrefix ? `${o.location.orderPrefix}-` : ""}${String(o.displayNumber ?? 0).padStart(4, "0")}`, at: o.occurredAt, totalMinor: financial ? o.totalMinor : null, status: o.status, orderType: o.orderType, branch: o.location.name }));
  }

  // ---- best sellers
  if (financial) {
    const { rows } = await soldItems({ ...q, currencyCode: currency });
    out.topItems = [...rows].sort((x, y) => y.revenueMinor - x.revenueMinor).slice(0, 6).map((r) => ({ name: r.name, qty: r.qty, revenueMinor: r.revenueMinor }));
    const variantIds = rows.filter((r) => r.key.startsWith("v:")).map((r) => r.key.slice(2));
    const variants = variantIds.length ? await db.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, product: { select: { category: { select: { name: true } } } } } }) : [];
    const categoryOf = new Map(variants.map((v) => [v.id, v.product.category.name]));
    const byCategory = new Map<string, number>();
    for (const r of rows) { const c = r.kind === "combo" ? "Deals" : categoryOf.get(r.key.slice(2)) ?? "Other"; byCategory.set(c, (byCategory.get(c) ?? 0) + r.revenueMinor); }
    out.categories = [...byCategory.entries()].map(([name, revenueMinor]) => ({ name, revenueMinor })).sort((a, b) => b.revenueMinor - a.revenueMinor).slice(0, 8);
    const sales = rows.reduce((t, r) => t + r.revenueMinor, 0);
    const costed = rows.filter((r) => r.hasRecipe);
    const costedSales = costed.reduce((t, r) => t + r.revenueMinor, 0);
    out.foodCost = { pct: costedSales > 0 ? Math.round((costed.reduce((t, r) => t + r.costMinor, 0) / costedSales) * 1000) / 10 : null, coveragePct: sales > 0 ? Math.round((costedSales / sales) * 100) : 100 };
  }

  // ---- things that need attention
  const alerts: Record<string, unknown> = {};
  const jobs: Promise<void>[] = [];
  if (has("approvals.view")) jobs.push(db.approvalRequest.count({ where: { status: "PENDING" } }).then((n) => { alerts.approvals = n; }));
  if (has("shifts.view")) jobs.push(db.cashShift.count({ where: { locationId: { in: locationIds }, status: "OPEN" } }).then((n) => { alerts.openShifts = n; }));
  if (has("delivery.view")) {
    jobs.push((async () => {
      const dOrders = await db.order.findMany({ where: { locationId: { in: locationIds }, orderType: "DELIVERY", status: { notIn: ["OPEN", "CANCELLED", "COMPLETED"] } }, select: { id: true } });
      const assigned = dOrders.length ? await db.deliveryAssignment.findMany({ where: { orderId: { in: dOrders.map((o) => o.id) }, status: { in: ["ASSIGNED", "PICKED_UP"] } }, select: { orderId: true } }) : [];
      alerts.deliveriesWaiting = dOrders.length - assigned.length;
    })());
  }
  if (has("inventory.view")) {
    jobs.push((async () => {
      const [items, levels] = await Promise.all([db.inventoryItem.findMany({ where: { isActive: true, reorderLevel: { not: null } }, select: { id: true, reorderLevel: true } }), db.stockLevel.findMany({ where: { locationId: { in: locationIds } }, select: { itemId: true, qty: true } })]);
      const total = new Map<string, number>();
      for (const l of levels) total.set(l.itemId, (total.get(l.itemId) ?? 0) + Number(l.qty));
      alerts.lowStock = items.filter((i) => (total.get(i.id) ?? 0) <= Number(i.reorderLevel)).length;
    })());
  }
  if (has("invoices.manage")) {
    jobs.push(db.supplierInvoice.findMany({ where: { status: { in: ["OPEN", "PARTIALLY_PAID"] }, dueDate: { lt: asDate(isoDay(new Date())) } }, select: { totalMinor: true, paidMinor: true } }).then((rows) => { alerts.overdueInvoices = { count: rows.length, amountMinor: rows.reduce((s, r) => s + r.totalMinor - r.paidMinor, 0) }; }));
  }
  if (has("feedback.view")) {
    jobs.push(db.feedback.findMany({ where: { locationId: { in: locationIds }, createdAt: { gte: asDate(q.from), lt: new Date(asDate(q.to).getTime() + 86_400_000) } }, select: { rating: true, status: true } }).then((rows) => {
      alerts.feedback = { count: rows.length, newCount: rows.filter((r) => r.status === "NEW").length, average: rows.length ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 10) / 10 : null };
    }));
  }
  if (has("staff.view") || has("timeclock.manage")) jobs.push(db.timeEntry.count({ where: { locationId: { in: locationIds }, clockOutAt: null } }).then((n) => { alerts.clockedIn = n; }));
  const ops: Record<string, unknown> = {};
  if (has("inventory.view")) {
    jobs.push(db.stockLevel.findMany({ where: { locationId: { in: locationIds }, qty: { gt: 0 } }, select: { qty: true, avgCost: true } }).then((rows) => { ops.stockValueMinor = Math.round(rows.reduce((t, l) => t + Number(l.qty) * Number(l.avgCost), 0)); }));
  }
  if (has("invoices.manage")) {
    jobs.push(db.supplierInvoice.findMany({ where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } }, select: { totalMinor: true, paidMinor: true } }).then((rows) => { ops.owedMinor = rows.reduce((t, r) => t + r.totalMinor - r.paidMinor, 0); }));
  }
  if (financial && (has("timeclock.manage") || has("staff.view"))) {
    jobs.push(db.timeEntry.findMany({ where: { locationId: { in: locationIds }, clockInAt: { gte: asDate(q.from), lt: new Date(asDate(q.to).getTime() + 86_400_000) } }, select: { clockInAt: true, clockOutAt: true, breakMinutes: true, employee: { select: { hourlyRateMinor: true } } } }).then((rows) => {
      let hours = 0, cost = 0;
      for (const e of rows) { const h = Math.max(0, ((e.clockOutAt ?? new Date()).getTime() - e.clockInAt.getTime()) / 3_600_000 - e.breakMinutes / 60); hours += h; cost += h * (e.employee.hourlyRateMinor ?? 0); }
      ops.labour = { hours: Math.round(hours * 10) / 10, costMinor: Math.round(cost) };
    }));
  }
  if (has("customers.view")) {
    jobs.push(Promise.all([db.customer.count({}), db.customer.count({ where: { createdAt: { gte: asDate(q.from), lt: new Date(asDate(q.to).getTime() + 86_400_000) } } }), db.customer.findMany({ select: { loyaltyPoints: true } })]).then(([total, fresh, pts]) => { ops.customers = { total, new: fresh, pointsOutstanding: pts.reduce((t, c) => t + c.loyaltyPoints, 0) }; }));
  }
  if (has("delivery.view")) {
    jobs.push((async () => {
      const dOrders = orders.filter((o) => o.orderType === "DELIVERY");
      const failed = dOrders.length ? await db.deliveryAssignment.count({ where: { orderId: { in: dOrders.map((o) => o.id) }, status: "FAILED" } }) : 0;
      ops.delivery = { orders: dOrders.length, completed: dOrders.filter((o) => o.status === "COMPLETED").length, failed };
    })());
  }
  await Promise.all(jobs);
  out.alerts = alerts;
  out.ops = ops;

  res.json({ data: out });
});

export const dashboardInsightsRouter = dash.router;
