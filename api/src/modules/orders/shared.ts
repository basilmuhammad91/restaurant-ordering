import { formatOrderNumber, priceOrder, type OrderDiscountInput } from "@restoflux/contracts";
import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client.js";
import { requireContext } from "../../core/context/context.js";
import type { Tx } from "../../core/db/scoped.js";
import { AppError, notFound } from "../../core/http/errors.js";

// Pieces shared by the order, kitchen and shift routes: how an order is read back, how it is stored,
// and how its totals are recalculated after a line is voided.

export const orderInclude = {
  location: { select: { name: true, orderPrefix: true, timezone: true, receiptHeader: true, receiptFooter: true, address: true, city: true, phone: true } },
  lines: { orderBy: { sortOrder: "asc" }, include: { modifiers: true, taxes: true } },
  discounts: true,
  payments: { orderBy: { occurredAt: "asc" }, include: { paymentMethod: { select: { name: true, type: true } } } },
  refunds: { orderBy: { occurredAt: "asc" }, include: { paymentMethod: { select: { name: true, type: true } } } },
  events: { orderBy: { at: "asc" } },
} satisfies Prisma.OrderInclude;

export type OrderFull = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** The order as the admin app, the POS and receipts use it: combo parts nested under their combo, a number to show. */
export function toOrderDto(o: OrderFull) {
  const children = new Map<string, OrderFull["lines"]>();
  for (const l of o.lines) if (l.parentLineId) children.set(l.parentLineId, [...(children.get(l.parentLineId) ?? []), l]);
  const lines = o.lines.filter((l) => !l.parentLineId).map((l) => ({ ...l, children: children.get(l.id) ?? [] }));
  const { location, ...rest } = o;
  return {
    ...rest,
    lines,
    businessDate: dateOnly(o.businessDate),
    orderNumber: formatOrderNumber(location.orderPrefix, o.displayNumber),
    dueMinor: Math.max(o.totalMinor - o.paidMinor, 0),
    location,
  };
}

export async function loadOrder(tx: Tx, id: string): Promise<OrderFull> {
  const order = await tx.order.findFirst({ where: { id }, include: orderInclude });
  if (!order) throw notFound("order");
  return order;
}

/** Next order number for a branch and trading day. One atomic statement, so two tills can never get the same number. */
export async function nextOrderNumber(tx: Tx, locationId: string, businessDate: string): Promise<number> {
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO order_sequences ("tenantId", "locationId", "businessDate", "lastNumber")
    VALUES (${requireContext().tenantId}::uuid, ${locationId}::uuid, ${businessDate}::date, 1)
    ON CONFLICT ("locationId", "businessDate") DO UPDATE SET "lastNumber" = order_sequences."lastNumber" + 1
    RETURNING "lastNumber"`;
  return rows[0]!.lastNumber;
}

export const asDate = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T00:00:00.000Z`);

/**
 * Recalculate an order's totals from its remaining (not voided) lines, keeping the tax rates that were
 * snapshotted on it. Used after a void. Returns the new total BEFORE writing so callers can refuse first.
 */
export async function repriceOrder(tx: Tx, orderId: string, opts: { dryRun?: boolean } = {}) {
  const order = await tx.order.findFirstOrThrow({ where: { id: orderId }, include: { lines: { include: { taxes: true } }, discounts: true } });
  const active = order.lines.filter((l) => l.status !== "VOIDED" && l.kind !== "COMBO_ITEM");
  const discountRow = order.discounts[0];
  const discount: OrderDiscountInput | null = discountRow
    ? discountRow.valueType === "PERCENT" ? { type: "PERCENT", percentBp: discountRow.value } : { type: "AMOUNT", amountMinor: discountRow.value }
    : null;

  const priced = priceOrder({
    lines: active.map((l) => ({
      key: l.id, unitMinor: l.unitPriceMinor, quantity: l.quantity,
      taxRules: l.taxes.map((t) => ({ ruleId: t.ruleId, name: t.ruleNameSnapshot, authorityCode: t.authorityCode, rateBp: t.rateBp })),
    })),
    pricesIncludeTax: order.pricesIncludeTax,
    discount,
    deliveryFeeMinor: order.deliveryFeeMinor,
  });
  if (opts.dryRun) return { order, priced };

  const tenantId = requireContext().tenantId;
  for (const p of priced.lines) {
    await tx.orderLine.update({ where: { id: p.key }, data: { lineSubtotalMinor: p.subtotalMinor, discountMinor: p.discountMinor, taxMinor: p.taxMinor, lineTotalMinor: p.totalMinor } });
  }
  const activeIds = active.map((l) => l.id);
  if (activeIds.length) {
    await tx.orderLineTax.deleteMany({ where: { lineId: { in: activeIds } } });
    await tx.orderLineTax.createMany({
      data: priced.lines.flatMap((p) => p.taxLines.map((t) => ({ id: randomUUID(), tenantId, lineId: p.key, ruleId: t.ruleId ?? null, ruleNameSnapshot: t.name, authorityCode: t.authorityCode, rateBp: t.rateBp, baseMinor: t.baseMinor, taxMinor: t.taxMinor, isInclusive: t.isInclusive }))),
    });
  }
  await tx.order.update({ where: { id: orderId }, data: { subtotalMinor: priced.subtotalMinor, discountMinor: priced.discountMinor, taxMinor: priced.taxMinor, totalMinor: priced.totalMinor } });
  if (discountRow) await tx.orderDiscount.update({ where: { id: discountRow.id }, data: { amountMinor: priced.discountMinor } });
  return { order, priced };
}

export const conflictError = (message: string, details?: unknown) => new AppError(409, "CONFLICT", message, details);
