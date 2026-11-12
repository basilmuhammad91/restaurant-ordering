import { reportQuerySchema, supplierLedgerQuerySchema, type ReportQuery } from "@restoflux/contracts";
import { db } from "../../core/db/scoped.js";
import { notFound } from "../../core/http/errors.js";
import { securedRouter } from "../../core/http/secured.js";
import { variantCostMap } from "../inventory/stock.js";

// REPORTS. Read-only views over what the rest of the system already recorded. Each one takes a period and
// the brand/branches chosen in the top bar, and never mixes currencies: a report is always in ONE currency
// (the organization's own unless another is asked for), because adding rupees to dirhams is meaningless.

const reports = securedRouter("/api/v1/reports");
const asDate = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T00:00:00.000Z`);
const dayAfter = (yyyyMmDd: string) => new Date(asDate(yyyyMmDd).getTime() + 86_400_000);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: unknown) => Number(d);

/** The branches a report covers: the ones asked for (that the person can see) in the chosen currency. */
async function scopeOf(q: ReportQuery) {
  const currency = q.currencyCode ?? (await db.tenant.findFirst({ select: { baseCurrency: true } }))?.baseCurrency ?? "USD";
  const locations = await db.location.findMany({
    where: { currencyCode: currency, ...(q.locationIds?.length && { id: { in: q.locationIds } }), ...(q.brandId && { brandId: q.brandId }) },
    select: { id: true, name: true },
  });
  return { currency, locationIds: locations.map((l) => l.id), locationName: new Map(locations.map((l) => [l.id, l.name])) };
}

const userNames = async (ids: (string | null | undefined)[]) => {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const users = unique.length ? await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }) : [];
  return new Map(users.map((u) => [u.id, u.name]));
};

// ---------------------------------------------------------------- what sold, what it cost
interface SoldRow { key: string; name: string; kind: "item" | "combo"; qty: number; revenueMinor: number; costMinor: number; hasRecipe: boolean }

/** Every item sold in the period with its net revenue and, where a recipe exists, its ingredient cost. */
async function soldItems(q: ReportQuery) {
  const { currency, locationIds } = await scopeOf(q);
  if (locationIds.length === 0) return { currency, rows: [] as SoldRow[], byDay: new Map<string, { salesMinor: number; costMinor: number }>() };
  const [lines, unitCost] = await Promise.all([
    db.orderLine.findMany({
      where: { status: { not: "VOIDED" }, order: { locationId: { in: locationIds }, currencyCode: currency, businessDate: { gte: asDate(q.from), lte: asDate(q.to) }, status: { notIn: ["OPEN", "CANCELLED"] } } },
      select: { id: true, parentLineId: true, kind: true, variantId: true, comboId: true, nameSnapshot: true, variantNameSnapshot: true, quantity: true, lineSubtotalMinor: true, discountMinor: true, taxMinor: true, order: { select: { businessDate: true, pricesIncludeTax: true } } },
    }),
    variantCostMap(db),
  ]);
  const childCost = new Map<string, number>();
  for (const l of lines) if (l.kind === "COMBO_ITEM" && l.parentLineId && l.variantId) childCost.set(l.parentLineId, (childCost.get(l.parentLineId) ?? 0) + (unitCost.get(l.variantId) ?? 0) * l.quantity);

  const rows = new Map<string, SoldRow>();
  const byDay = new Map<string, { salesMinor: number; costMinor: number }>();
  for (const l of lines) {
    if (l.kind === "COMBO_ITEM") continue; // a combo is sold (and costed) through its parent line
    const key = l.kind === "COMBO" ? `c:${l.comboId}` : `v:${l.variantId}`;
    const revenue = l.lineSubtotalMinor - l.discountMinor - (l.order.pricesIncludeTax ? l.taxMinor : 0);
    const cost = l.kind === "COMBO" ? childCost.get(l.id) ?? 0 : (l.variantId ? (unitCost.get(l.variantId) ?? 0) * l.quantity : 0);
    const hasRecipe = l.kind === "COMBO" ? childCost.has(l.id) : !!l.variantId && unitCost.has(l.variantId);
    const name = l.kind === "ITEM" && l.variantNameSnapshot && l.variantNameSnapshot !== "Regular" ? `${l.nameSnapshot} (${l.variantNameSnapshot})` : l.nameSnapshot;
    const row = rows.get(key) ?? { key, name, kind: l.kind === "COMBO" ? "combo" : "item", qty: 0, revenueMinor: 0, costMinor: 0, hasRecipe: true };
    row.qty += l.quantity; row.revenueMinor += revenue; row.costMinor += cost; row.hasRecipe = row.hasRecipe && hasRecipe;
    rows.set(key, row);
    const day = isoDay(l.order.businessDate);
    const d = byDay.get(day) ?? { salesMinor: 0, costMinor: 0 };
    d.salesMinor += revenue; d.costMinor += cost;
    byDay.set(day, d);
  }
  return { currency, rows: [...rows.values()], byDay };
}

/**
 * Menu engineering: each item is placed by how popular it is and how much it earns per sale.
 * Star = popular and profitable; Plowhorse = popular, thin margin; Puzzle = profitable, slow seller; Dog = neither.
 * (Popular = sells at least 70% of an even share; profitable = margin at or above the menu's average.)
 */
reports.get("/menu-performance", ["reports.menu.view", "reports.foodcost.view"], async (req, res) => {
  const q = reportQuerySchema.parse(req.query);
  const { currency, rows } = await soldItems(q);
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const costed = rows.filter((r) => r.hasRecipe && r.qty > 0);
  const avgMargin = costed.length ? costed.reduce((s, r) => s + (r.revenueMinor - r.costMinor), 0) / costed.reduce((s, r) => s + r.qty, 0) : 0;
  const popularAt = rows.length ? (totalQty / rows.length) * 0.7 : 0;
  const data = rows.map((r) => {
    const marginPerUnit = r.hasRecipe && r.qty ? (r.revenueMinor - r.costMinor) / r.qty : null;
    const popular = r.qty >= popularAt;
    const profitable = marginPerUnit !== null ? marginPerUnit >= avgMargin : null;
    const group = profitable === null ? null : popular ? (profitable ? "STAR" : "PLOWHORSE") : profitable ? "PUZZLE" : "DOG";
    return { ...r, avgPriceMinor: r.qty ? Math.round(r.revenueMinor / r.qty) : 0, unitCostMinor: r.hasRecipe && r.qty ? Math.round(r.costMinor / r.qty) : null, marginMinor: r.hasRecipe ? Math.round(r.revenueMinor - r.costMinor) : null, marginPerUnitMinor: marginPerUnit === null ? null : Math.round(marginPerUnit), costPct: r.hasRecipe && r.revenueMinor > 0 ? Math.round((r.costMinor / r.revenueMinor) * 1000) / 10 : null, group, popular };
  }).sort((a, b) => b.revenueMinor - a.revenueMinor);
  res.json({ data, meta: { currencyCode: currency, totalQty, averageMarginPerUnitMinor: Math.round(avgMargin), withoutRecipe: rows.filter((r) => !r.hasRecipe).length } });
});

/** Food cost: what the dishes sold should have cost, plus waste and counted losses, against sales. */
reports.get("/food-cost", "reports.foodcost.view", async (req, res) => {
  const q = reportQuerySchema.parse(req.query);
  const { currency, locationIds } = await scopeOf(q);
  const { rows, byDay } = await soldItems(q);
  const sales = rows.reduce((s, r) => s + r.revenueMinor, 0);
  const theoretical = rows.reduce((s, r) => s + r.costMinor, 0);
  const soldQty = rows.reduce((s, r) => s + r.qty, 0);
  const coveredQty = rows.filter((r) => r.hasRecipe).reduce((s, r) => s + r.qty, 0);

  const moves = locationIds.length
    ? await db.stockMovement.findMany({ where: { locationId: { in: locationIds }, businessDate: { gte: asDate(q.from), lte: asDate(q.to) }, type: { in: ["WASTE", "EXPIRED", "DAMAGE", "STAFF_MEAL", "COUNT", "PURCHASE"] } }, select: { type: true, qty: true, unitCost: true, itemId: true, item: { select: { name: true, unit: true } } } })
    : [];
  const value = (m: { qty: unknown; unitCost: unknown }) => num(m.qty) * num(m.unitCost);
  const lossTypes = ["WASTE", "EXPIRED", "DAMAGE", "STAFF_MEAL"];
  const wasteByType = lossTypes.map((type) => ({ type, valueMinor: Math.round(-moves.filter((m) => m.type === type).reduce((s, m) => s + value(m), 0)) }));
  const waste = wasteByType.reduce((s, w) => s + w.valueMinor, 0);
  const shrink = Math.round(-moves.filter((m) => m.type === "COUNT").reduce((s, m) => s + value(m), 0)); // positive = stock went missing
  const purchases = Math.round(moves.filter((m) => m.type === "PURCHASE").reduce((s, m) => s + value(m), 0));
  const wasted = new Map<string, { name: string; unit: string; qty: number; valueMinor: number }>();
  for (const m of moves.filter((x) => lossTypes.includes(x.type))) {
    const w = wasted.get(m.itemId) ?? { name: m.item.name, unit: m.item.unit, qty: 0, valueMinor: 0 };
    w.qty += -num(m.qty); w.valueMinor += Math.round(-value(m)); wasted.set(m.itemId, w);
  }
  const actual = theoretical + waste + shrink;
  const pct = (n: number) => (sales > 0 ? Math.round((n / sales) * 1000) / 10 : null);
  res.json({
    data: {
      currencyCode: currency, salesMinor: sales, soldQty, recipeCoveragePct: soldQty ? Math.round((coveredQty / soldQty) * 100) : 100,
      theoreticalCostMinor: Math.round(theoretical), theoreticalPct: pct(theoretical), wasteMinor: waste, wasteByType, shrinkMinor: shrink,
      actualCostMinor: Math.round(actual), actualPct: pct(actual), grossProfitMinor: Math.round(sales - actual), purchasesMinor: purchases,
      topWasted: [...wasted.values()].sort((a, b) => b.valueMinor - a.valueMinor).slice(0, 10),
      byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, salesMinor: Math.round(d.salesMinor), costMinor: Math.round(d.costMinor), pct: d.salesMinor > 0 ? Math.round((d.costMinor / d.salesMinor) * 1000) / 10 : null })),
    },
  });
});

// ---------------------------------------------------------------- inventory
reports.get("/inventory", "reports.inventory.view", async (req, res) => {
  const q = reportQuerySchema.parse(req.query);
  const { currency, locationIds, locationName } = await scopeOf(q);
  if (locationIds.length === 0) return res.json({ data: { currencyCode: currency, totalValueMinor: 0, byLocation: [], byCategory: [], lowCount: 0, outCount: 0, movement: [], topUsage: [] } });
  const [levels, items, moves] = await Promise.all([
    db.stockLevel.findMany({ where: { locationId: { in: locationIds } } }),
    db.inventoryItem.findMany({ where: { isActive: true }, select: { id: true, name: true, unit: true, category: true, reorderLevel: true } }),
    db.stockMovement.findMany({ where: { locationId: { in: locationIds }, businessDate: { gte: asDate(q.from), lte: asDate(q.to) } }, select: { type: true, qty: true, unitCost: true, itemId: true } }),
  ]);
  const itemOf = new Map(items.map((i) => [i.id, i]));
  const byLocation = new Map<string, { locationId: string; name: string; valueMinor: number; items: number }>();
  const byCategory = new Map<string, { category: string; valueMinor: number }>();
  let total = 0, low = 0, out = 0;
  const totals = new Map<string, number>();
  for (const l of levels) {
    const it = itemOf.get(l.itemId);
    if (!it) continue;
    const v = Math.max(0, num(l.qty)) * num(l.avgCost);
    total += v;
    const loc = byLocation.get(l.locationId) ?? { locationId: l.locationId, name: locationName.get(l.locationId) ?? "?", valueMinor: 0, items: 0 };
    loc.valueMinor += v; if (num(l.qty) > 0) loc.items++;
    byLocation.set(l.locationId, loc);
    const cat = it.category ?? "Uncategorised";
    const c = byCategory.get(cat) ?? { category: cat, valueMinor: 0 };
    c.valueMinor += v; byCategory.set(cat, c);
    totals.set(l.itemId, (totals.get(l.itemId) ?? 0) + num(l.qty));
  }
  for (const it of items) {
    const qty = totals.get(it.id) ?? 0;
    if (qty <= 0) out++; else if (it.reorderLevel !== null && qty <= num(it.reorderLevel)) low++;
  }
  const byType = new Map<string, { type: string; count: number; valueMinor: number }>();
  const usage = new Map<string, { itemId: string; name: string; unit: string; qty: number; valueMinor: number }>();
  for (const m of moves) {
    const t = byType.get(m.type) ?? { type: m.type, count: 0, valueMinor: 0 };
    t.count++; t.valueMinor += num(m.qty) * num(m.unitCost); byType.set(m.type, t);
    if (m.type === "SALE") {
      const it = itemOf.get(m.itemId);
      const u = usage.get(m.itemId) ?? { itemId: m.itemId, name: it?.name ?? "?", unit: it?.unit ?? "", qty: 0, valueMinor: 0 };
      u.qty += -num(m.qty); u.valueMinor += -num(m.qty) * num(m.unitCost); usage.set(m.itemId, u);
    }
  }
  const round = <T extends { valueMinor: number }>(x: T) => ({ ...x, valueMinor: Math.round(x.valueMinor) });
  res.json({
    data: {
      currencyCode: currency, totalValueMinor: Math.round(total), lowCount: low, outCount: out,
      byLocation: [...byLocation.values()].map(round).sort((a, b) => b.valueMinor - a.valueMinor),
      byCategory: [...byCategory.values()].map(round).sort((a, b) => b.valueMinor - a.valueMinor),
      movement: [...byType.values()].map(round).sort((a, b) => b.count - a.count),
      topUsage: [...usage.values()].map((u) => ({ ...round(u), qty: Math.round(u.qty * 1000) / 1000 })).sort((a, b) => b.valueMinor - a.valueMinor).slice(0, 10),
    },
  });
});

// ---------------------------------------------------------------- purchasing
reports.get("/purchasing", "reports.purchasing.view", async (req, res) => {
  const q = reportQuerySchema.parse(req.query);
  const { currency, locationIds } = await scopeOf(q);
  const when = { gte: asDate(q.from), lt: dayAfter(q.to) };
  const [receipts, orders, invoices, payments] = await Promise.all([
    locationIds.length ? db.goodsReceipt.findMany({ where: { locationId: { in: locationIds }, receivedAt: when }, select: { supplierId: true, supplier: { select: { name: true } }, lines: { select: { itemId: true, qty: true, unitCost: true, totalMinor: true, item: { select: { name: true, unit: true } } } } } }) : Promise.resolve([]),
    locationIds.length ? db.purchaseOrder.findMany({ where: { locationId: { in: locationIds }, createdAt: when }, select: { status: true, totalMinor: true } }) : Promise.resolve([]),
    db.supplierInvoice.findMany({ where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } }, select: { totalMinor: true, paidMinor: true, dueDate: true } }),
    db.supplierPayment.findMany({ where: { paidAt: when }, select: { amountMinor: true } }),
  ]);
  const bySupplier = new Map<string, { supplierId: string; name: string; receipts: number; spendMinor: number }>();
  const byItem = new Map<string, { itemId: string; name: string; unit: string; qty: number; spendMinor: number }>();
  for (const r of receipts) {
    const s = bySupplier.get(r.supplierId) ?? { supplierId: r.supplierId, name: r.supplier.name, receipts: 0, spendMinor: 0 };
    s.receipts++; s.spendMinor += r.lines.reduce((t, l) => t + l.totalMinor, 0); bySupplier.set(r.supplierId, s);
    for (const l of r.lines) {
      const i = byItem.get(l.itemId) ?? { itemId: l.itemId, name: l.item.name, unit: l.item.unit, qty: 0, spendMinor: 0 };
      i.qty += num(l.qty); i.spendMinor += l.totalMinor; byItem.set(l.itemId, i);
    }
  }
  const today = isoDay(new Date());
  const aging = { current: 0, d1_30: 0, d31_60: 0, d60plus: 0 };
  for (const i of invoices) {
    const owed = i.totalMinor - i.paidMinor;
    const late = Math.floor((asDate(today).getTime() - i.dueDate.getTime()) / 86_400_000);
    if (late <= 0) aging.current += owed; else if (late <= 30) aging.d1_30 += owed; else if (late <= 60) aging.d31_60 += owed; else aging.d60plus += owed;
  }
  const statusCounts: Record<string, { orders: number; totalMinor: number }> = {};
  for (const o of orders) { const s = (statusCounts[o.status] ??= { orders: 0, totalMinor: 0 }); s.orders++; s.totalMinor += o.totalMinor; }
  res.json({
    data: {
      currencyCode: currency,
      spendMinor: [...bySupplier.values()].reduce((s, x) => s + x.spendMinor, 0),
      paidMinor: payments.reduce((s, p) => s + p.amountMinor, 0),
      outstandingMinor: Object.values(aging).reduce((s, n) => s + n, 0),
      aging,
      bySupplier: [...bySupplier.values()].sort((a, b) => b.spendMinor - a.spendMinor),
      topItems: [...byItem.values()].map((i) => ({ ...i, qty: Math.round(i.qty * 1000) / 1000, avgCostMinor: i.qty ? Math.round((i.spendMinor / i.qty) * 100) / 100 : 0 })).sort((a, b) => b.spendMinor - a.spendMinor).slice(0, 15),
      ordersByStatus: statusCounts,
    },
  });
});

/** One supplier's account: invoices in, payments out, running balance (what we owe them). */
reports.get("/supplier-ledger", ["reports.purchasing.view", "invoices.manage"], async (req, res) => {
  const q = supplierLedgerQuerySchema.parse(req.query);
  const supplier = await db.supplier.findFirst({ where: { id: q.supplierId }, select: { id: true, name: true } });
  if (!supplier) throw notFound("supplier");
  const [invoices, payments] = await Promise.all([
    db.supplierInvoice.findMany({ where: { supplierId: q.supplierId, status: { not: "VOID" } }, select: { invoiceNo: true, invoiceDate: true, totalMinor: true } }),
    db.supplierPayment.findMany({ where: { invoice: { supplierId: q.supplierId } }, select: { paidAt: true, amountMinor: true, method: true, reference: true, invoice: { select: { invoiceNo: true } } } }),
  ]);
  type Entry = { date: string; type: "invoice" | "payment"; ref: string; debitMinor: number; creditMinor: number };
  const all: Entry[] = [
    ...invoices.map((i) => ({ date: isoDay(i.invoiceDate), type: "invoice" as const, ref: i.invoiceNo, debitMinor: i.totalMinor, creditMinor: 0 })),
    ...payments.map((p) => ({ date: isoDay(p.paidAt), type: "payment" as const, ref: `${p.invoice.invoiceNo} · ${p.method}${p.reference ? ` (${p.reference})` : ""}`, debitMinor: 0, creditMinor: p.amountMinor })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.type === "invoice" ? -1 : 1));
  const opening = all.filter((e) => e.date < q.from).reduce((s, e) => s + e.debitMinor - e.creditMinor, 0);
  let balance = opening;
  const entries = all.filter((e) => e.date >= q.from && e.date <= q.to).map((e) => ({ ...e, balanceMinor: (balance += e.debitMinor - e.creditMinor) }));
  res.json({ data: { supplier, openingMinor: opening, closingMinor: balance, entries } });
});

// ---------------------------------------------------------------- fraud watch
interface UserStat { userId: string; voids: number; voidMinor: number; refunds: number; refundMinor: number; discounts: number; discountMinor: number; cashOuts: number; cashOutMinor: number; shortMinor: number; shortShifts: number; wasteEntries: number; wasteMinor: number }

/**
 * Exceptions by person: voids, refunds, discounts, cash taken out, till shortages and stock written off.
 * A flag does not mean wrongdoing: it marks someone far above their colleagues, worth a look.
 */
reports.get("/fraud", "reports.fraud.view", async (req, res) => {
  const q = reportQuerySchema.parse(req.query);
  const { currency, locationIds } = await scopeOf(q);
  const stats = new Map<string, UserStat>();
  const stat = (id: string | null | undefined) => {
    if (!id) return null;
    let s = stats.get(id);
    if (!s) stats.set(id, (s = { userId: id, voids: 0, voidMinor: 0, refunds: 0, refundMinor: 0, discounts: 0, discountMinor: 0, cashOuts: 0, cashOutMinor: 0, shortMinor: 0, shortShifts: 0, wasteEntries: 0, wasteMinor: 0 }));
    return s;
  };
  if (locationIds.length) {
    const date = { gte: asDate(q.from), lte: asDate(q.to) };
    const [voids, refunds, discounts, cash, shifts, waste] = await Promise.all([
      db.orderLine.findMany({ where: { status: "VOIDED", voidedById: { not: null }, kind: { not: "COMBO_ITEM" }, locationId: { in: locationIds }, order: { businessDate: date, currencyCode: currency } }, select: { voidedById: true, lineTotalMinor: true } }),
      db.refund.findMany({ where: { locationId: { in: locationIds }, businessDate: date, order: { currencyCode: currency } }, select: { requestedById: true, amountMinor: true } }),
      db.orderDiscount.findMany({ where: { source: "MANUAL", order: { locationId: { in: locationIds }, businessDate: date, currencyCode: currency, status: { not: "CANCELLED" } } }, select: { appliedById: true, amountMinor: true } }),
      db.cashMovement.findMany({ where: { locationId: { in: locationIds }, type: { in: ["CASH_OUT", "PAID_OUT"] }, shift: { businessDate: date, currencyCode: currency } }, select: { createdById: true, amountMinor: true } }),
      db.cashShift.findMany({ where: { locationId: { in: locationIds }, status: "CLOSED", businessDate: date, currencyCode: currency, varianceMinor: { not: 0 } }, select: { closedById: true, varianceMinor: true } }),
      db.stockMovement.findMany({ where: { locationId: { in: locationIds }, businessDate: date, type: { in: ["WASTE", "EXPIRED", "DAMAGE"] } }, select: { createdById: true, qty: true, unitCost: true } }),
    ]);
    for (const v of voids) { const s = stat(v.voidedById); if (s) { s.voids++; s.voidMinor += v.lineTotalMinor; } }
    for (const r of refunds) { const s = stat(r.requestedById); if (s) { s.refunds++; s.refundMinor += r.amountMinor; } }
    for (const d of discounts) { const s = stat(d.appliedById); if (s) { s.discounts++; s.discountMinor += d.amountMinor; } }
    for (const c of cash) { const s = stat(c.createdById); if (s) { s.cashOuts++; s.cashOutMinor += c.amountMinor; } }
    for (const sh of shifts) { const s = stat(sh.closedById); if (s && (sh.varianceMinor ?? 0) < 0) { s.shortShifts++; s.shortMinor += -(sh.varianceMinor ?? 0); } }
    for (const w of waste) { const s = stat(w.createdById); if (s) { s.wasteEntries++; s.wasteMinor += Math.round(-num(w.qty) * num(w.unitCost)); } }
  }
  const people = [...stats.values()];
  const names = await userNames(people.map((p) => p.userId));
  const mean = (pick: (p: UserStat) => number) => (people.length ? people.reduce((s, p) => s + pick(p), 0) / people.length : 0);
  const avg = { voidMinor: mean((p) => p.voidMinor), refundMinor: mean((p) => p.refundMinor), discountMinor: mean((p) => p.discountMinor), cashOutMinor: mean((p) => p.cashOutMinor) };
  const data = people.map((p) => {
    const flags: string[] = [];
    if (p.voids >= 3 && p.voidMinor >= 2 * avg.voidMinor) flags.push("Voids well above colleagues");
    if (p.refunds >= 2 && p.refundMinor >= 2 * avg.refundMinor) flags.push("Refunds well above colleagues");
    if (p.discounts >= 3 && p.discountMinor >= 2 * avg.discountMinor) flags.push("Heavy discounting");
    if (p.cashOuts >= 3 && p.cashOutMinor >= 2 * avg.cashOutMinor) flags.push("Frequent cash taken out");
    if (p.shortShifts >= 2) flags.push(`Till short on ${p.shortShifts} shifts`);
    return { ...p, name: names.get(p.userId) ?? "Unknown", flags };
  }).sort((a, b) => b.flags.length - a.flags.length || b.voidMinor + b.refundMinor + b.discountMinor - (a.voidMinor + a.refundMinor + a.discountMinor));
  const sum = (pick: (p: UserStat) => number) => people.reduce((s, p) => s + pick(p), 0);
  res.json({ data, meta: { currencyCode: currency, flagged: data.filter((d) => d.flags.length).length, voidMinor: sum((p) => p.voidMinor), refundMinor: sum((p) => p.refundMinor), discountMinor: sum((p) => p.discountMinor), cashOutMinor: sum((p) => p.cashOutMinor), shortMinor: sum((p) => p.shortMinor) } });
});

export const reportsExtraRouter = reports.router;
