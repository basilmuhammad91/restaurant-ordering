import { expectedCash, type CashFigures } from "@restoflux/contracts";
import { db, type Tx } from "../../core/db/scoped.js";
import { asDate } from "./shared.js";

// SALES FIGURES. One place computes "how much did we sell": the dashboard, the sales report and the
// Z-report all call it, so they can never disagree. Money is summed per currency (a company trading in
// PKR and AED never gets a meaningless mixed total).
//   net sales = total - tax - delivery fees      (works for tax-inclusive and tax-exclusive prices alike)

export interface SalesBucket { orders: number; totalMinor: number }
export interface MethodBucket { name: string; type: string; count: number; amountMinor: number; tipMinor: number }

export interface SalesSummary {
  currencyCode: string;
  orders: number;
  grossSalesMinor: number;
  discountsMinor: number;
  netSalesMinor: number;
  taxMinor: number;
  deliveryFeesMinor: number;
  tipsMinor: number;
  totalMinor: number;
  averageOrderMinor: number;
  byOrderType: Record<string, SalesBucket>;
  byChannel: Record<string, SalesBucket>;
  byStatus: Record<string, number>;
  byPaymentMethod: MethodBucket[];
  collectedMinor: number;
  refunds: { count: number; amountMinor: number };
  voids: { lines: number; amountMinor: number };
  cancelled: { orders: number; amountMinor: number };
  byDay: { date: string; orders: number; totalMinor: number }[];
}

const empty = (currencyCode: string): SalesSummary => ({
  currencyCode, orders: 0, grossSalesMinor: 0, discountsMinor: 0, netSalesMinor: 0, taxMinor: 0, deliveryFeesMinor: 0, tipsMinor: 0, totalMinor: 0, averageOrderMinor: 0,
  byOrderType: {}, byChannel: {}, byStatus: {}, byPaymentMethod: [], collectedMinor: 0, refunds: { count: 0, amountMinor: 0 }, voids: { lines: 0, amountMinor: 0 }, cancelled: { orders: 0, amountMinor: 0 }, byDay: [],
});

const bump = (m: Record<string, SalesBucket>, key: string, total: number) => {
  const b = (m[key] ??= { orders: 0, totalMinor: 0 });
  b.orders += 1;
  b.totalMinor += total;
};

export interface SalesQuery {
  locationIds?: string[] | undefined;
  brandId?: string | undefined;
  from: string;
  to: string;
  /** Only orders and payments belonging to this cash shift (shift Z-report). */
  shiftId?: string | undefined;
}

export async function buildSalesSummary(q: SalesQuery, client: Tx | typeof db = db): Promise<SalesSummary[]> {
  const dateRange = { gte: asDate(q.from), lte: asDate(q.to) };
  const scope = { ...(q.locationIds?.length && { locationId: { in: q.locationIds } }), ...(q.brandId && { brandId: q.brandId }) };

  const orders = await client.order.findMany({
    where: { ...scope, businessDate: dateRange, status: { not: "OPEN" }, ...(q.shiftId && { cashShiftId: q.shiftId }) },
    select: { status: true, orderType: true, channel: true, currencyCode: true, businessDate: true, subtotalMinor: true, discountMinor: true, taxMinor: true, deliveryFeeMinor: true, tipMinor: true, totalMinor: true },
  });
  const payments = await client.payment.findMany({
    where: { ...(q.locationIds?.length && { locationId: { in: q.locationIds } }), businessDate: dateRange, status: "CAPTURED", ...(q.shiftId && { cashShiftId: q.shiftId }) },
    select: { amountMinor: true, tipMinor: true, currencyCode: true, paymentMethod: { select: { name: true, type: true } } },
  });
  const refunds = await client.refund.findMany({
    where: { ...(q.locationIds?.length && { locationId: { in: q.locationIds } }), businessDate: dateRange, ...(q.shiftId && { cashShiftId: q.shiftId }) },
    select: { amountMinor: true, order: { select: { currencyCode: true } } },
  });
  const voided = await client.orderLine.findMany({
    where: { ...(q.locationIds?.length && { locationId: { in: q.locationIds } }), status: "VOIDED", kind: { not: "COMBO_ITEM" }, order: { businessDate: dateRange, ...(q.brandId && { brandId: q.brandId }), ...(q.shiftId && { cashShiftId: q.shiftId }) } },
    select: { lineTotalMinor: true, order: { select: { currencyCode: true } } },
  });

  const out = new Map<string, SalesSummary>();
  const of = (cur: string) => {
    let s = out.get(cur);
    if (!s) out.set(cur, (s = empty(cur)));
    return s;
  };
  const days = new Map<string, Map<string, { orders: number; totalMinor: number }>>();

  for (const o of orders) {
    const s = of(o.currencyCode);
    s.byStatus[o.status] = (s.byStatus[o.status] ?? 0) + 1;
    if (o.status === "CANCELLED") {
      s.cancelled.orders += 1;
      s.cancelled.amountMinor += o.totalMinor;
      continue;
    }
    s.orders += 1;
    s.grossSalesMinor += o.subtotalMinor;
    s.discountsMinor += o.discountMinor;
    s.taxMinor += o.taxMinor;
    s.deliveryFeesMinor += o.deliveryFeeMinor;
    s.tipsMinor += o.tipMinor;
    s.totalMinor += o.totalMinor;
    bump(s.byOrderType, o.orderType, o.totalMinor);
    bump(s.byChannel, o.channel, o.totalMinor);
    const date = o.businessDate.toISOString().slice(0, 10);
    const perDay = days.get(o.currencyCode) ?? new Map();
    const d = perDay.get(date) ?? { orders: 0, totalMinor: 0 };
    d.orders += 1;
    d.totalMinor += o.totalMinor;
    perDay.set(date, d);
    days.set(o.currencyCode, perDay);
  }

  const methodMaps = new Map<string, Map<string, MethodBucket>>();
  for (const p of payments) {
    const s = of(p.currencyCode);
    const m = methodMaps.get(p.currencyCode) ?? new Map<string, MethodBucket>();
    const b = m.get(p.paymentMethod.name) ?? { name: p.paymentMethod.name, type: p.paymentMethod.type, count: 0, amountMinor: 0, tipMinor: 0 };
    b.count += 1;
    b.amountMinor += p.amountMinor;
    b.tipMinor += p.tipMinor;
    m.set(p.paymentMethod.name, b);
    methodMaps.set(p.currencyCode, m);
    s.collectedMinor += p.amountMinor;
  }
  for (const r of refunds) {
    const s = of(r.order.currencyCode);
    s.refunds.count += 1;
    s.refunds.amountMinor += r.amountMinor;
  }
  for (const v of voided) {
    const s = of(v.order.currencyCode);
    s.voids.lines += 1;
    s.voids.amountMinor += v.lineTotalMinor;
  }

  for (const [cur, s] of out) {
    s.netSalesMinor = s.totalMinor - s.taxMinor - s.deliveryFeesMinor;
    s.averageOrderMinor = s.orders ? Math.round(s.totalMinor / s.orders) : 0;
    s.byPaymentMethod = [...(methodMaps.get(cur)?.values() ?? [])].sort((a, b) => b.amountMinor - a.amountMinor);
    s.byDay = [...(days.get(cur)?.entries() ?? [])].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
  }
  return [...out.values()].sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));
}

/** The money that moved through one shift's drawer, and what should be in it. */
export async function shiftFigures(tx: Tx, shift: { id: string; openingFloatMinor: number }): Promise<CashFigures & { expectedCashMinor: number }> {
  const [payments, refunds, movements] = await Promise.all([
    tx.payment.findMany({ where: { cashShiftId: shift.id, status: "CAPTURED" }, select: { amountMinor: true, tipMinor: true, paymentMethod: { select: { type: true } } } }),
    tx.refund.findMany({ where: { cashShiftId: shift.id }, select: { amountMinor: true, paymentMethod: { select: { type: true } } } }),
    tx.cashMovement.findMany({ where: { shiftId: shift.id }, select: { type: true, amountMinor: true } }),
  ]);
  const sum = (rows: { amountMinor: number }[]) => rows.reduce((a, r) => a + r.amountMinor, 0);
  const figures: CashFigures = {
    openingFloatMinor: shift.openingFloatMinor,
    // a tip handed over in cash stays in the drawer, so it counts as cash taken
    cashSalesMinor: payments.filter((p) => p.paymentMethod.type === "CASH").reduce((a, p) => a + p.amountMinor + p.tipMinor, 0),
    cashRefundsMinor: sum(refunds.filter((r) => r.paymentMethod.type === "CASH")),
    cashInMinor: sum(movements.filter((m) => m.type === "CASH_IN")),
    cashOutMinor: sum(movements.filter((m) => m.type === "CASH_OUT")),
    paidOutMinor: sum(movements.filter((m) => m.type === "PAID_OUT")),
    safeDropsMinor: sum(movements.filter((m) => m.type === "SAFE_DROP")),
  };
  return { ...figures, expectedCashMinor: expectedCash(figures) };
}
