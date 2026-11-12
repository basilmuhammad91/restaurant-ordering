import {
  adjustmentInputSchema, countCreateSchema, countLinesSchema, idSchema, inventoryItemInputSchema, inventoryItemUpdateSchema,
  movementQuerySchema, productionInputSchema, recipeInputSchema, transferCreateSchema, transferReceiveSchema,
} from "@restoflux/contracts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext } from "../../core/context/context.js";
import { unscopedDb } from "../../core/db/client.js";
import { db, type Tx } from "../../core/db/scoped.js";
import { AppError, fieldError, forbidden, notFound } from "../../core/http/errors.js";
import { offsetMeta, paging } from "../../core/http/pagination.js";
import { boolQuery, defineResource } from "../../core/http/resource.js";
import { securedRouter } from "../../core/http/secured.js";
import { documentNumber, itemCostMap, postMovement, businessDateAt, recipeCost, round3, round6 } from "./stock.js";

const ctx = () => requireContext();
const idParams = z.object({ id: idSchema });
const conflict = (message: string) => new AppError(409, "CONFLICT", message);
const asDate = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T00:00:00.000Z`);

/** The branch must exist and be one this person may work in (the scoped client hides everything else). */
async function requireLocation(tx: Tx, id: string) {
  const location = await tx.location.findFirst({ where: { id } });
  if (!location) throw notFound("location");
  return location;
}
const canSee = (locationId: string) => ctx().allLocations || ctx().locationIds.includes(locationId);

// ---------------------------------------------------------------- items
export const inventoryItemsRouter = defineResource({
  mount: "/api/v1/inventory-items", label: "item", entityType: "InventoryItem", auditPrefix: "inventory.items",
  model: (c) => c.inventoryItem as never,
  permissions: { read: ["inventory.view", "items.manage", "recipes.manage"], write: "items.manage" },
  createSchema: inventoryItemInputSchema, updateSchema: inventoryItemUpdateSchema,
  searchFields: ["name", "sku", "category"], sortable: ["name", "category", "kind", "unit"], defaultSort: "name",
  filters: { kind: z.enum(["RAW", "PREP", "PACKAGING"]).optional(), isActive: boolQuery.optional() },
});

// ---------------------------------------------------------------- stock on hand and the ledger
const stock = securedRouter("/api/v1/inventory");

/** Everything a picker needs in one call: all active items and every menu item that can have a recipe. */
stock.get("/options", ["inventory.view", "items.manage", "recipes.manage", "inventory.count", "inventory.adjust", "inventory.transfer", "inventory.production"], async (_req, res) => {
  const [items, variants] = await Promise.all([
    db.inventoryItem.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 2000, select: { id: true, name: true, unit: true, kind: true, sku: true } }),
    db.productVariant.findMany({ where: { deletedAt: null, product: { isActive: true } }, take: 3000, select: { id: true, name: true, product: { select: { name: true } } } }),
  ]);
  const menuItems = variants.map((v) => ({ id: v.id, label: v.name === "Regular" ? v.product.name : `${v.product.name} (${v.name})` })).sort((a, b) => a.label.localeCompare(b.label));
  res.json({ data: { items, menuItems } });
});

stock.get("/stock", "inventory.view", async (req, res) => {
  const q = z.object({ locationId: idSchema, q: z.string().trim().max(100).optional(), low: boolQuery.optional() }).parse(req.query);
  await requireLocation(db, q.locationId);
  const search = q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" as const } }, { sku: { contains: q.q, mode: "insensitive" as const } }] } : {};
  const [items, levels] = await Promise.all([
    db.inventoryItem.findMany({ where: { isActive: true, ...search }, orderBy: { name: "asc" }, take: 1000 }),
    db.stockLevel.findMany({ where: { locationId: q.locationId } }),
  ]);
  const byItem = new Map(levels.map((l) => [l.itemId, l]));
  let rows = items.map((i) => {
    const l = byItem.get(i.id);
    const qty = l ? Number(l.qty) : 0;
    const avgCost = l && Number(l.avgCost) > 0 ? Number(l.avgCost) : Number(i.referenceCost);
    const reorder = i.reorderLevel === null ? null : Number(i.reorderLevel);
    return {
      itemId: i.id, name: i.name, sku: i.sku, kind: i.kind, unit: i.unit, category: i.category, qty, avgCost: round6(avgCost),
      valueMinor: Math.round(qty * avgCost), reorderLevel: reorder, parLevel: i.parLevel === null ? null : Number(i.parLevel),
      status: qty <= 0 ? "out" : reorder !== null && qty <= reorder ? "low" : "ok",
    };
  });
  if (q.low) rows = rows.filter((r) => r.status !== "ok");
  const totalValueMinor = rows.reduce((s, r) => s + Math.max(0, r.valueMinor), 0);
  res.json({ data: rows, meta: { totalValueMinor, lowCount: rows.filter((r) => r.status === "low").length, outCount: rows.filter((r) => r.status === "out").length } });
});

stock.get("/movements", "inventory.view", async (req, res) => {
  const q = movementQuerySchema.parse(req.query);
  await requireLocation(db, q.locationId);
  const types = q.types ? q.types.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const where = {
    locationId: q.locationId,
    ...(q.itemId && { itemId: q.itemId }),
    ...(types.length && { type: { in: types as never[] } }),
    ...((q.from || q.to) && { businessDate: { ...(q.from && { gte: asDate(q.from) }), ...(q.to && { lte: asDate(q.to) }) } }),
  };
  const [rows, total] = await Promise.all([
    db.stockMovement.findMany({ where, orderBy: { createdAt: "desc" }, ...paging(q), include: { item: { select: { name: true, unit: true } } } }),
    db.stockMovement.count({ where }),
  ]);
  const userIds = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  res.json({ data: rows.map((r) => ({ ...r, itemName: r.item.name, unit: r.item.unit, createdByName: r.createdById ? nameOf.get(r.createdById) ?? null : null })), meta: offsetMeta(q, total) });
});

/** Waste, expiry, damage, staff meals, opening stock and plain corrections. Each one is a ledger row with a reason. */
stock.post("/adjustments", "inventory.adjust", async (req, res) => {
  const input = adjustmentInputSchema.parse(req.body);
  const out = await db.$transaction(async (tx) => {
    await requireLocation(tx, input.locationId);
    const takesOut = ["WASTE", "EXPIRED", "DAMAGE", "STAFF_MEAL"].includes(input.type);
    const signed = takesOut ? -Math.abs(input.qty) : input.type === "OPENING" ? Math.abs(input.qty) : input.qty;
    const result = await postMovement(tx, {
      locationId: input.locationId, itemId: input.itemId, type: input.type, qty: signed, reason: input.reason ?? null, refType: "ADJUSTMENT",
      ...(input.unitCost !== undefined && { unitCost: input.unitCost }),
    });
    await recordAudit(tx, { action: `inventory.${input.type.toLowerCase()}`, entityType: "InventoryItem", entityId: input.itemId, locationId: input.locationId, reason: input.reason ?? null, after: { qty: signed, qtyAfter: result.qtyAfter } });
    return result;
  });
  res.status(201).json({ data: out });
});

// ---------------------------------------------------------------- recipes
const recipes = securedRouter("/api/v1/recipes");
const RECIPE_READ = ["recipes.manage", "inventory.view"] as const;

recipes.get("/", [...RECIPE_READ], async (req, res) => {
  const q = z.object({ kind: z.enum(["menu", "prep"]).optional(), q: z.string().trim().max(100).optional() }).parse(req.query);
  const costs = await itemCostMap(db);
  const list = await db.recipe.findMany({
    where: { ...(q.kind === "menu" && { variantId: { not: null } }), ...(q.kind === "prep" && { prepItemId: { not: null } }) },
    include: { lines: true, variant: { select: { id: true, name: true, product: { select: { name: true } } } }, prepItem: { select: { id: true, name: true, unit: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const needle = q.q?.toLowerCase();
  const rows = list.map((r) => {
    const total = r.lines.reduce((s, l) => s + Number(l.qty) * (1 + Number(l.wastePercent) / 100) * (costs.get(l.itemId) ?? 0), 0);
    const target = r.variant ? (r.variant.name === "Regular" ? r.variant.product.name : `${r.variant.product.name} (${r.variant.name})`) : r.prepItem!.name;
    return { id: r.id, kind: r.variantId ? "menu" : "prep", variantId: r.variantId, prepItemId: r.prepItemId, targetName: target, yieldQty: Number(r.yieldQty), unit: r.prepItem?.unit ?? null, ingredients: r.lines.length, costPerUnitMinor: round6(total / Number(r.yieldQty)), isActive: r.isActive };
  }).filter((r) => !needle || r.targetName.toLowerCase().includes(needle));
  res.json({ data: rows });
});

recipes.get("/:id", [...RECIPE_READ], async (req, res) => {
  const { id } = idParams.parse(req.params);
  const recipe = await db.recipe.findFirst({ where: { id }, include: { variant: { select: { id: true, name: true, product: { select: { name: true } } } }, prepItem: { select: { id: true, name: true, unit: true } } } });
  if (!recipe) throw notFound("recipe");
  const cost = await recipeCost(db, id);
  res.json({ data: { ...recipe, cost } });
});

/** Create or replace the recipe for a menu item or a prep item (one recipe per target). */
recipes.put("/", "recipes.manage", async (req, res) => {
  const input = recipeInputSchema.parse(req.body);
  const saved = await db.$transaction(async (tx) => {
    if (input.variantId) { if (!(await tx.productVariant.findFirst({ where: { id: input.variantId, deletedAt: null } }))) throw notFound("menu item"); }
    if (input.prepItemId) {
      const prep = await tx.inventoryItem.findFirst({ where: { id: input.prepItemId, deletedAt: null } });
      if (!prep) throw notFound("prep item");
      if (prep.kind !== "PREP") throw fieldError("prepItemId", "Only a prep item can have a batch recipe");
    }
    const ids = input.lines.map((l) => l.itemId);
    if (new Set(ids).size !== ids.length) throw fieldError("lines", "An ingredient appears twice");
    if (input.prepItemId && ids.includes(input.prepItemId)) throw fieldError("lines", "A prep item cannot be an ingredient of itself");
    const found = await tx.inventoryItem.count({ where: { id: { in: ids }, deletedAt: null } });
    if (found !== ids.length) throw fieldError("lines", "One of the ingredients does not exist");

    const where = input.variantId ? { variantId: input.variantId } : { prepItemId: input.prepItemId! };
    const before = await tx.recipe.findFirst({ where });
    const base = { yieldQty: input.yieldQty ?? 1, notes: input.notes ?? null, isActive: true };
    const recipe = before
      ? await tx.recipe.update({ where: { id: before.id }, data: base })
      : await tx.recipe.create({ data: { tenantId: ctx().tenantId, ...where, ...base } });
    await tx.recipeLine.deleteMany({ where: { recipeId: recipe.id } });
    await tx.recipeLine.createMany({ data: input.lines.map((l, i) => ({ tenantId: ctx().tenantId, recipeId: recipe.id, itemId: l.itemId, qty: l.qty, wastePercent: l.wastePercent ?? 0, sortOrder: i })) });
    await recordAudit(tx, { action: before ? "recipes.update" : "recipes.create", entityType: "Recipe", entityId: recipe.id, after: { ...where, lines: input.lines.length } });
    return recipe;
  });
  res.status(201).json({ data: saved });
});

recipes.delete("/:id", "recipes.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  await db.$transaction(async (tx) => {
    const r = await tx.recipe.findFirst({ where: { id } });
    if (!r) throw notFound("recipe");
    await tx.recipeLine.deleteMany({ where: { recipeId: id } });
    await tx.recipe.delete({ where: { id } });
    await recordAudit(tx, { action: "recipes.delete", entityType: "Recipe", entityId: id, before: { variantId: r.variantId, prepItemId: r.prepItemId } });
  });
  res.status(204).end();
});

// ---------------------------------------------------------------- counts
const counts = securedRouter("/api/v1/stock-counts");

counts.get("/", "inventory.count", async (req, res) => {
  const q = z.object({ locationId: idSchema.optional(), status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "CANCELLED"]).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
  const where = { ...(q.locationId && { locationId: q.locationId }), ...(q.status && { status: q.status }) };
  const [rows, total] = await Promise.all([
    db.stockCount.findMany({ where, orderBy: { createdAt: "desc" }, ...paging(q), include: { location: { select: { name: true } }, lines: { select: { expectedQty: true, countedQty: true, unitCost: true } } } }),
    db.stockCount.count({ where }),
  ]);
  const data = rows.map(({ lines, location, ...c }) => {
    const counted = lines.filter((l) => l.countedQty !== null);
    return { ...c, locationName: location.name, lineCount: lines.length, countedCount: counted.length, varianceValueMinor: Math.round(counted.reduce((s, l) => s + (Number(l.countedQty) - Number(l.expectedQty)) * Number(l.unitCost), 0)) };
  });
  res.json({ data, meta: offsetMeta(q, total) });
});

counts.get("/:id", "inventory.count", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const count = await db.stockCount.findFirst({ where: { id }, include: { location: { select: { name: true } }, lines: { include: { item: { select: { name: true, unit: true, sku: true, category: true } } } } } });
  if (!count) throw notFound("count");
  count.lines.sort((a, b) => a.item.name.localeCompare(b.item.name));
  res.json({ data: count });
});

counts.post("/", "inventory.count", async (req, res) => {
  const input = countCreateSchema.parse(req.body);
  const created = await db.$transaction(async (tx) => {
    const location = await requireLocation(tx, input.locationId);
    const items = await tx.inventoryItem.findMany({ where: { isActive: true, ...(input.itemIds && { id: { in: input.itemIds } }) }, select: { id: true, referenceCost: true } });
    if (items.length === 0) throw conflict("There is nothing to count yet. Add inventory items first.");
    const levels = await tx.stockLevel.findMany({ where: { locationId: location.id } });
    const byItem = new Map(levels.map((l) => [l.itemId, l]));
    const date = await businessDateAt(tx, location.id);
    const count = await tx.stockCount.create({
      data: { tenantId: ctx().tenantId, locationId: location.id, number: documentNumber("CNT"), businessDate: asDate(date), note: input.note ?? null, createdById: ctx().userId },
    });
    await tx.stockCountLine.createMany({
      data: items.map((i) => { const l = byItem.get(i.id); return { tenantId: ctx().tenantId, countId: count.id, itemId: i.id, expectedQty: l ? l.qty : 0, unitCost: l && Number(l.avgCost) > 0 ? l.avgCost : i.referenceCost }; }),
    });
    await recordAudit(tx, { action: "inventory.count.start", entityType: "StockCount", entityId: count.id, locationId: location.id, after: { number: count.number, lines: items.length } });
    return count;
  });
  res.status(201).json({ data: created });
});

counts.put("/:id/lines", "inventory.count", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = countLinesSchema.parse(req.body);
  await db.$transaction(async (tx) => {
    const count = await tx.stockCount.findFirst({ where: { id } });
    if (!count) throw notFound("count");
    if (count.status !== "DRAFT") throw conflict("Only a count in progress can be edited");
    for (const l of input.lines) await tx.stockCountLine.updateMany({ where: { countId: id, itemId: l.itemId }, data: { countedQty: l.countedQty } });
  });
  res.json({ data: { saved: input.lines.length } });
});

counts.post("/:id/submit", "inventory.count", async (req, res) => {
  const { id } = idParams.parse(req.params);
  await db.$transaction(async (tx) => {
    const count = await tx.stockCount.findFirst({ where: { id } });
    if (!count) throw notFound("count");
    if (count.status !== "DRAFT") throw conflict("This count was already submitted");
    if ((await tx.stockCountLine.count({ where: { countId: id, countedQty: { not: null } } })) === 0) throw conflict("Count at least one item first");
    await tx.stockCount.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
    await recordAudit(tx, { action: "inventory.count.submit", entityType: "StockCount", entityId: id, locationId: count.locationId });
  });
  res.json({ data: { status: "SUBMITTED" } });
});

/** Approving applies the differences: the system quantity becomes what was counted, one ledger row per item. */
counts.post("/:id/approve", "inventory.count.approve", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const out = await db.$transaction(async (tx) => {
    const count = await tx.stockCount.findFirst({ where: { id }, include: { lines: true } });
    if (!count) throw notFound("count");
    if (count.status !== "SUBMITTED") throw conflict("Only a submitted count can be approved");
    let adjusted = 0;
    for (const l of count.lines) {
      if (l.countedQty === null) continue;
      const level = await tx.stockLevel.findFirst({ where: { locationId: count.locationId, itemId: l.itemId }, select: { qty: true } });
      const diff = round3(Number(l.countedQty) - (level ? Number(level.qty) : 0));
      if (diff === 0) continue;
      await postMovement(tx, { locationId: count.locationId, itemId: l.itemId, type: "COUNT", qty: diff, reason: `Count ${count.number}`, refType: "COUNT", refId: id, allowNegative: true });
      adjusted++;
    }
    await tx.stockCount.update({ where: { id }, data: { status: "APPROVED", approvedById: ctx().userId, approvedAt: new Date() } });
    await recordAudit(tx, { action: "inventory.count.approve", entityType: "StockCount", entityId: id, locationId: count.locationId, after: { adjusted } });
    return { adjusted };
  });
  res.json({ data: out });
});

counts.post("/:id/cancel", "inventory.count", async (req, res) => {
  const { id } = idParams.parse(req.params);
  await db.$transaction(async (tx) => {
    const count = await tx.stockCount.findFirst({ where: { id } });
    if (!count) throw notFound("count");
    if (count.status === "APPROVED" || count.status === "CANCELLED") throw conflict("This count is already closed");
    await tx.stockCount.update({ where: { id }, data: { status: "CANCELLED" } });
    await recordAudit(tx, { action: "inventory.count.cancel", entityType: "StockCount", entityId: id, locationId: count.locationId });
  });
  res.json({ data: { status: "CANCELLED" } });
});

// ---------------------------------------------------------------- transfers
const transfers = securedRouter("/api/v1/stock-transfers");

async function locationNames(ids: string[]) {
  const rows = await unscopedDb.location.findMany({ where: { tenantId: ctx().tenantId, id: { in: ids } }, select: { id: true, name: true, type: true } });
  return new Map(rows.map((r) => [r.id, r]));
}
async function loadTransfer(tx: Tx, id: string) {
  const t = await tx.stockTransfer.findFirst({ where: { id }, include: { lines: { include: { item: { select: { name: true, unit: true } } } } } });
  if (!t) throw notFound("transfer");
  if (!canSee(t.fromLocationId) && !canSee(t.toLocationId)) throw notFound("transfer"); // outside this person's branches
  return t;
}

transfers.get("/", "inventory.transfer", async (req, res) => {
  const q = z.object({ status: z.enum(["REQUESTED", "IN_TRANSIT", "RECEIVED", "CANCELLED"]).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
  const c = ctx();
  const where = { ...(q.status && { status: q.status }), ...(!c.allLocations && { OR: [{ fromLocationId: { in: [...c.locationIds] } }, { toLocationId: { in: [...c.locationIds] } }] }) };
  const [rows, total] = await Promise.all([
    db.stockTransfer.findMany({ where, orderBy: { createdAt: "desc" }, ...paging(q), include: { lines: { select: { id: true } } } }),
    db.stockTransfer.count({ where }),
  ]);
  const names = await locationNames([...new Set(rows.flatMap((r) => [r.fromLocationId, r.toLocationId]))]);
  res.json({ data: rows.map(({ lines, ...r }) => ({ ...r, lineCount: lines.length, fromName: names.get(r.fromLocationId)?.name ?? "?", toName: names.get(r.toLocationId)?.name ?? "?" })), meta: offsetMeta(q, total) });
});

transfers.get("/:id", "inventory.transfer", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const t = await loadTransfer(db, id);
  const names = await locationNames([t.fromLocationId, t.toLocationId]);
  res.json({ data: { ...t, fromName: names.get(t.fromLocationId)?.name ?? "?", toName: names.get(t.toLocationId)?.name ?? "?" } });
});

transfers.post("/", "inventory.transfer", async (req, res) => {
  const input = transferCreateSchema.parse(req.body);
  const created = await db.$transaction(async (tx) => {
    await requireLocation(tx, input.fromLocationId); // you can only send from a place you work in
    const to = await unscopedDb.location.findFirst({ where: { tenantId: ctx().tenantId, id: input.toLocationId, deletedAt: null } });
    if (!to) throw fieldError("toLocationId", "That location does not exist");
    const ids = input.lines.map((l) => l.itemId);
    if (new Set(ids).size !== ids.length) throw fieldError("lines", "An item appears twice");
    if ((await tx.inventoryItem.count({ where: { id: { in: ids }, deletedAt: null } })) !== ids.length) throw fieldError("lines", "One of the items does not exist");
    const t = await tx.stockTransfer.create({ data: { tenantId: ctx().tenantId, number: documentNumber("TRF"), fromLocationId: input.fromLocationId, toLocationId: input.toLocationId, note: input.note ?? null, requestedById: ctx().userId } });
    await tx.stockTransferLine.createMany({ data: input.lines.map((l) => ({ tenantId: ctx().tenantId, transferId: t.id, itemId: l.itemId, qty: l.qty })) });
    await recordAudit(tx, { action: "inventory.transfer.request", entityType: "StockTransfer", entityId: t.id, locationId: input.fromLocationId, after: { number: t.number, to: input.toLocationId, lines: ids.length } });
    return t;
  });
  res.status(201).json({ data: created });
});

/** Shipping takes the stock out of the sending location at its current cost. */
transfers.post("/:id/ship", "inventory.transfer.approve", async (req, res) => {
  const { id } = idParams.parse(req.params);
  await db.$transaction(async (tx) => {
    const t = await loadTransfer(tx, id);
    if (!canSee(t.fromLocationId)) throw forbidden("Only the sending location can ship this transfer");
    if (t.status !== "REQUESTED") throw conflict("This transfer was already sent or closed");
    for (const l of t.lines) {
      const { unitCost } = await postMovement(tx, { locationId: t.fromLocationId, itemId: l.itemId, type: "TRANSFER_OUT", qty: -Number(l.qty), reason: `Transfer ${t.number}`, refType: "TRANSFER", refId: t.id });
      await tx.stockTransferLine.update({ where: { id: l.id }, data: { unitCost } });
    }
    await tx.stockTransfer.update({ where: { id }, data: { status: "IN_TRANSIT", shippedAt: new Date() } });
    await recordAudit(tx, { action: "inventory.transfer.ship", entityType: "StockTransfer", entityId: id, locationId: t.fromLocationId });
  });
  res.json({ data: { status: "IN_TRANSIT" } });
});

/** Receiving puts what arrived into the receiving location. Anything short stays a recorded loss on the transfer. */
transfers.post("/:id/receive", "inventory.transfer", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = transferReceiveSchema.parse(req.body ?? { lines: [] });
  await db.$transaction(async (tx) => {
    const t = await loadTransfer(tx, id);
    if (!canSee(t.toLocationId)) throw forbidden("Only the receiving location can receive this transfer");
    if (t.status !== "IN_TRANSIT") throw conflict("This transfer is not on its way");
    const got = new Map(input.lines.map((l) => [l.itemId, l.receivedQty]));
    for (const l of t.lines) {
      const receivedQty = got.get(l.itemId) ?? Number(l.qty);
      if (receivedQty > Number(l.qty)) throw fieldError("lines", `${l.item.name}: more arrived than was sent`);
      if (receivedQty > 0) await postMovement(tx, { locationId: t.toLocationId, itemId: l.itemId, type: "TRANSFER_IN", qty: receivedQty, unitCost: Number(l.unitCost), reason: `Transfer ${t.number}`, refType: "TRANSFER", refId: t.id });
      await tx.stockTransferLine.update({ where: { id: l.id }, data: { receivedQty } });
    }
    await tx.stockTransfer.update({ where: { id }, data: { status: "RECEIVED", receivedAt: new Date(), receivedById: ctx().userId } });
    await recordAudit(tx, { action: "inventory.transfer.receive", entityType: "StockTransfer", entityId: id, locationId: t.toLocationId });
  });
  res.json({ data: { status: "RECEIVED" } });
});

transfers.post("/:id/cancel", "inventory.transfer", async (req, res) => {
  const { id } = idParams.parse(req.params);
  await db.$transaction(async (tx) => {
    const t = await loadTransfer(tx, id);
    if (t.status !== "REQUESTED") throw conflict("A transfer that has been sent cannot be cancelled. Receive it and adjust instead.");
    await tx.stockTransfer.update({ where: { id }, data: { status: "CANCELLED" } });
    await recordAudit(tx, { action: "inventory.transfer.cancel", entityType: "StockTransfer", entityId: id, locationId: t.fromLocationId });
  });
  res.json({ data: { status: "CANCELLED" } });
});

// ---------------------------------------------------------------- production (central kitchen)
const production = securedRouter("/api/v1/production");

production.get("/", "inventory.production", async (req, res) => {
  const q = z.object({ locationId: idSchema.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
  const where = q.locationId ? { locationId: q.locationId } : {};
  const [rows, total] = await Promise.all([
    db.productionRun.findMany({ where, orderBy: { createdAt: "desc" }, ...paging(q), include: { prepItem: { select: { name: true, unit: true } }, location: { select: { name: true } } } }),
    db.productionRun.count({ where }),
  ]);
  res.json({ data: rows.map(({ prepItem, location, ...r }) => ({ ...r, itemName: prepItem.name, unit: prepItem.unit, locationName: location.name })), meta: offsetMeta(q, total) });
});

/** A batch: the recipe's ingredients leave stock, and the prepared item enters it at the cost of what went in. */
production.post("/", "inventory.production", async (req, res) => {
  const input = productionInputSchema.parse(req.body);
  const run = await db.$transaction(async (tx) => {
    const location = await requireLocation(tx, input.locationId);
    const recipe = await tx.recipe.findFirst({ where: { prepItemId: input.prepItemId, isActive: true }, include: { lines: true } });
    if (!recipe) throw conflict("This prep item has no recipe yet. Add one under Recipes first.");
    const runId = randomUUID();
    const factor = input.producedQty / Number(recipe.yieldQty);
    const date = await businessDateAt(tx, location.id);
    let totalCost = 0;
    for (const l of recipe.lines) {
      const qty = round3(Number(l.qty) * factor * (1 + Number(l.wastePercent) / 100));
      if (qty <= 0) continue;
      const { unitCost } = await postMovement(tx, { locationId: location.id, itemId: l.itemId, type: "PRODUCTION_OUT", qty: -qty, reason: "Used in production", refType: "PRODUCTION", refId: runId, businessDate: date });
      totalCost += qty * unitCost;
    }
    await postMovement(tx, { locationId: location.id, itemId: input.prepItemId, type: "PRODUCTION_IN", qty: input.producedQty, unitCost: round6(totalCost / input.producedQty), reason: "Production batch", refType: "PRODUCTION", refId: runId, businessDate: date });
    const created = await tx.productionRun.create({ data: { id: runId, tenantId: ctx().tenantId, locationId: location.id, prepItemId: input.prepItemId, producedQty: input.producedQty, businessDate: asDate(date), note: input.note ?? null, createdById: ctx().userId } });
    await recordAudit(tx, { action: "inventory.production", entityType: "ProductionRun", entityId: runId, locationId: location.id, after: { prepItemId: input.prepItemId, producedQty: input.producedQty, costMinor: Math.round(totalCost) } });
    return created;
  });
  res.status(201).json({ data: run });
});

export const stockRouter = stock.router;
export const recipesRouter = recipes.router;
export const stockCountsRouter = counts.router;
export const stockTransfersRouter = transfers.router;
export const productionRouter = production.router;
