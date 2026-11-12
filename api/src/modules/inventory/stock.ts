import { businessDateOf } from "@restoflux/contracts";
import { randomUUID } from "node:crypto";
import { requireContext } from "../../core/context/context.js";
import type { Tx } from "../../core/db/scoped.js";
import { AppError, notFound } from "../../core/http/errors.js";
import { notify } from "../../core/notifications/notify.js";

// THE STOCK ENGINE. Every change to stock goes through postMovement(): it takes a row lock on the branch's
// stock level, writes one ledger row and updates the running total and the weighted average cost, all in the
// caller's transaction. Nothing else may touch stock_levels or stock_movements.
// (Laravel: one service class every controller calls, never touching the stock column directly.)

export type MovementType =
  | "OPENING" | "PURCHASE" | "SALE" | "SALE_REVERSAL" | "ADJUSTMENT" | "WASTE" | "EXPIRED" | "DAMAGE" | "STAFF_MEAL"
  | "COUNT" | "TRANSFER_OUT" | "TRANSFER_IN" | "PRODUCTION_IN" | "PRODUCTION_OUT";

/** Types that bring stock in at a known cost (they move the average). */
const COSTED_IN = new Set<MovementType>(["OPENING", "PURCHASE", "TRANSFER_IN", "PRODUCTION_IN"]);

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export const insufficientStock = (itemName: string, have: number, need: number, unit: string) =>
  new AppError(409, "CONFLICT", `Not enough ${itemName}: ${round3(have)} ${unit} on hand, ${round3(need)} ${unit} needed`);

export interface MovementInput {
  locationId: string;
  itemId: string;
  type: MovementType;
  /** Signed: positive brings stock in, negative takes it out. */
  qty: number;
  /** Cost per unit for stock coming in. Defaults to the current average (or the item's reference cost). */
  unitCost?: number;
  reason?: string | null;
  refType?: string;
  refId?: string;
  /** false lets stock go below zero (a sale must never be blocked by an inaccurate shelf count). */
  allowNegative?: boolean;
  businessDate?: string;
}

interface LocationClock { timezone: string; businessDayStartTime: string | null }

/** The trading day for "now" at a branch (a night shift trades on the day it started). */
export async function businessDateAt(tx: Tx, locationId: string, at = new Date()): Promise<string> {
  const loc: LocationClock | null = await tx.location.findFirst({ where: { id: locationId }, select: { timezone: true, businessDayStartTime: true } });
  if (!loc) throw notFound("location");
  return businessDateOf(at, loc.timezone, loc.businessDayStartTime ?? "05:00");
}

export async function postMovement(tx: Tx, m: MovementInput): Promise<{ qtyAfter: number; unitCost: number }> {
  const ctx = requireContext();
  if (m.qty === 0) throw new AppError(422, "VALIDATION_ERROR", "A stock movement must move something");

  // Both lookups go through the scoped client: another organization's (or an unreachable branch's) ids simply are not found.
  const item = await tx.inventoryItem.findFirst({ where: { id: m.itemId }, select: { id: true, name: true, unit: true, referenceCost: true, reorderLevel: true } });
  if (!item) throw notFound("item");
  const businessDate = m.businessDate ?? (await businessDateAt(tx, m.locationId));

  // make sure the level row exists, then lock it for the rest of the transaction
  await tx.$executeRaw`INSERT INTO stock_levels (id, "tenantId", "locationId", "itemId", qty, "avgCost", "updatedAt")
    VALUES (${randomUUID()}::uuid, ${ctx.tenantId}::uuid, ${m.locationId}::uuid, ${m.itemId}::uuid, 0, 0, now())
    ON CONFLICT ("locationId", "itemId") DO NOTHING`;
  const rows = await tx.$queryRaw<{ qty: string; avgCost: string }[]>`SELECT qty::text AS qty, "avgCost"::text AS "avgCost" FROM stock_levels
    WHERE "locationId" = ${m.locationId}::uuid AND "itemId" = ${m.itemId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
  const level = rows[0];
  if (!level) throw notFound("stock level");
  const qtyBefore = Number(level.qty);
  const avgBefore = Number(level.avgCost);
  const qtyAfter = round3(qtyBefore + m.qty);

  if (m.qty < 0 && qtyAfter < 0 && m.allowNegative !== true) throw insufficientStock(item.name, qtyBefore, -m.qty, item.unit);

  const fallbackCost = avgBefore > 0 ? avgBefore : Number(item.referenceCost);
  let avgAfter = avgBefore;
  let unitCost = fallbackCost;
  if (m.qty > 0 && COSTED_IN.has(m.type)) {
    unitCost = m.unitCost ?? fallbackCost;
    avgAfter = qtyBefore > 0 ? round6((qtyBefore * avgBefore + m.qty * unitCost) / (qtyBefore + m.qty)) : unitCost;
  } else if (m.unitCost !== undefined) {
    unitCost = m.unitCost;
  }

  await tx.$executeRaw`UPDATE stock_levels SET qty = ${qtyAfter}, "avgCost" = ${avgAfter}, "updatedAt" = now()
    WHERE "locationId" = ${m.locationId}::uuid AND "itemId" = ${m.itemId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid`;
  await tx.stockMovement.create({
    data: {
      tenantId: ctx.tenantId, locationId: m.locationId, itemId: m.itemId, type: m.type, qty: round3(m.qty), unitCost: round6(unitCost),
      businessDate: new Date(`${businessDate}T00:00:00.000Z`), reason: m.reason ?? null, refType: m.refType ?? null, refId: m.refId ?? null, createdById: ctx.userId,
    },
  });
  // crossing down through the reorder level alerts the people who look after stock at that branch (once a day per item)
  if (m.qty < 0 && item.reorderLevel !== null && qtyBefore > Number(item.reorderLevel) && qtyAfter <= Number(item.reorderLevel)) {
    const place = await tx.location.findFirst({ where: { id: m.locationId }, select: { name: true } });
    await notify(tx, {
      type: "LOW_STOCK", severity: qtyAfter <= 0 ? "CRITICAL" : "WARN", title: `Low stock at ${place?.name ?? "a branch"}: ${item.name}`,
      body: `${round3(qtyAfter)} ${item.unit} left (reorder level ${Number(item.reorderLevel)} ${item.unit}).`, requiredPermission: "inventory.view", locationId: m.locationId,
      entityType: "InventoryItem", entityId: item.id, dedupeKey: `low-stock:${m.locationId}:${item.id}:${businessDate}`,
    });
  }
  return { qtyAfter, unitCost };
}

/** Current quantity of an item at a branch (0 if it was never stocked). */
export async function qtyOnHand(tx: Tx, locationId: string, itemId: string): Promise<number> {
  const level = await tx.stockLevel.findFirst({ where: { locationId, itemId }, select: { qty: true } });
  return level ? Number(level.qty) : 0;
}

/** A short document number such as "CNT-261112-4F7": unique per organization, readable on paper. */
export function documentNumber(prefix: string): string {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${prefix}-${ymd}-${randomUUID().slice(0, 4).toUpperCase()}`;
}

// ---------------------------------------------------------------- costs
/** Cost per unit of every item: the average across stocked branches, or the item's reference cost when nothing is on hand. */
export async function itemCostMap(tx: Tx): Promise<Map<string, number>> {
  const [items, levels] = await Promise.all([
    tx.inventoryItem.findMany({ select: { id: true, referenceCost: true } }),
    tx.stockLevel.findMany({ where: { qty: { gt: 0 } }, select: { itemId: true, qty: true, avgCost: true } }),
  ]);
  const sums = new Map<string, { qty: number; value: number }>();
  for (const l of levels) {
    const s = sums.get(l.itemId) ?? { qty: 0, value: 0 };
    s.qty += Number(l.qty); s.value += Number(l.qty) * Number(l.avgCost);
    sums.set(l.itemId, s);
  }
  return new Map(items.map((i) => { const s = sums.get(i.id); return [i.id, s && s.qty > 0 ? s.value / s.qty : Number(i.referenceCost)]; }));
}

/** Cost of one portion for every menu variant that has a recipe (variant id -> minor units). Used by food-cost and menu reports. */
export async function variantCostMap(tx: Tx): Promise<Map<string, number>> {
  const [costs, recipes] = await Promise.all([itemCostMap(tx), tx.recipe.findMany({ where: { variantId: { not: null }, isActive: true }, include: { lines: true } })]);
  const out = new Map<string, number>();
  for (const r of recipes) {
    const total = r.lines.reduce((s, l) => s + Number(l.qty) * (1 + Number(l.wastePercent) / 100) * (costs.get(l.itemId) ?? 0), 0);
    out.set(r.variantId!, round6(total / Number(r.yieldQty)));
  }
  return out;
}

// ---------------------------------------------------------------- recipes
export interface RecipeCostLine { itemId: string; name: string; unit: string; qty: number; wastePercent: number; unitCost: number; lineCost: number }

/**
 * What one portion (or one unit of a batch) costs: each ingredient's quantity, grossed up for waste, at its
 * average cost across the organization's stock (or its reference cost if nothing is stocked yet).
 */
export async function recipeCost(tx: Tx, recipeId: string): Promise<{ lines: RecipeCostLine[]; total: number; perUnit: number } | null> {
  const recipe = await tx.recipe.findFirst({ where: { id: recipeId }, include: { lines: { include: { item: { include: { levels: { select: { qty: true, avgCost: true } } } } }, orderBy: { sortOrder: "asc" } } } });
  if (!recipe) return null;
  const lines = recipe.lines.map((l) => {
    const stocked = l.item.levels.filter((v) => Number(v.qty) > 0);
    const totalQty = stocked.reduce((s, v) => s + Number(v.qty), 0);
    const unitCost = totalQty > 0 ? stocked.reduce((s, v) => s + Number(v.qty) * Number(v.avgCost), 0) / totalQty : Number(l.item.referenceCost);
    const qty = Number(l.qty);
    const wastePercent = Number(l.wastePercent);
    return { itemId: l.itemId, name: l.item.name, unit: l.item.unit, qty, wastePercent, unitCost: round6(unitCost), lineCost: round6(qty * (1 + wastePercent / 100) * unitCost) };
  });
  const total = round6(lines.reduce((s, l) => s + l.lineCost, 0));
  return { lines, total, perUnit: round6(total / Number(recipe.yieldQty)) };
}

// ---------------------------------------------------------------- selling takes stock out
/**
 * Take the ingredients of a completed order out of stock. Runs inside the order-status transaction, so
 * either the order completes AND the stock moves, or neither happens. Safe to call twice (it checks for the
 * order's existing SALE rows first). Items without a recipe use no stock, and a sale never fails for lack of stock.
 */
export async function consumeForOrder(tx: Tx, orderId: string): Promise<number> {
  const done = await tx.stockMovement.findFirst({ where: { refType: "ORDER", refId: orderId, type: "SALE" }, select: { id: true } });
  if (done) return 0;
  const order = await tx.order.findFirst({ where: { id: orderId }, select: { id: true, locationId: true, businessDate: true } });
  if (!order) return 0;
  const lines = await tx.orderLine.findMany({ where: { orderId, status: { not: "VOIDED" }, variantId: { not: null }, kind: { in: ["ITEM", "COMBO_ITEM"] } }, select: { variantId: true, quantity: true } });
  if (lines.length === 0) return 0;

  const soldByVariant = new Map<string, number>();
  for (const l of lines) soldByVariant.set(l.variantId!, (soldByVariant.get(l.variantId!) ?? 0) + l.quantity);
  const recipes = await tx.recipe.findMany({ where: { variantId: { in: [...soldByVariant.keys()] }, isActive: true }, include: { lines: true } });

  const use = new Map<string, number>();
  for (const r of recipes) {
    const portions = soldByVariant.get(r.variantId!) ?? 0;
    for (const l of r.lines) use.set(l.itemId, (use.get(l.itemId) ?? 0) + portions * Number(l.qty) * (1 + Number(l.wastePercent) / 100) / Number(r.yieldQty));
  }
  const date = order.businessDate.toISOString().slice(0, 10);
  for (const [itemId, qty] of use) {
    if (qty <= 0) continue;
    await postMovement(tx, { locationId: order.locationId, itemId, type: "SALE", qty: -round3(qty), refType: "ORDER", refId: orderId, allowNegative: true, businessDate: date });
  }
  return use.size;
}
