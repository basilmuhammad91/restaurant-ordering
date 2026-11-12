import {
  directReceiptSchema, idSchema, invoiceInputSchema, supplierPaymentInputSchema, purchaseOrderInputSchema, receiveInputSchema,
  supplierInputSchema, supplierItemInputSchema, supplierItemUpdateSchema, supplierUpdateSchema,
} from "@restoflux/contracts";
import { z } from "zod";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext } from "../../core/context/context.js";
import { db, type Tx } from "../../core/db/scoped.js";
import { AppError, fieldError, notFound } from "../../core/http/errors.js";
import { offsetMeta, paging } from "../../core/http/pagination.js";
import { assertRef, boolQuery, defineResource } from "../../core/http/resource.js";
import { securedRouter } from "../../core/http/secured.js";
import { documentNumber, postMovement, round3, round6 } from "../inventory/stock.js";

const ctx = () => requireContext();
const idParams = z.object({ id: idSchema });
const conflict = (message: string) => new AppError(409, "CONFLICT", message);
const asDate = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const listQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), q: z.string().trim().max(100).optional() });

async function requireLocation(tx: Tx, id: string) {
  const location = await tx.location.findFirst({ where: { id } });
  if (!location) throw notFound("location");
  return location;
}

// ---------------------------------------------------------------- suppliers and what they sell
export const suppliersRouter = defineResource({
  mount: "/api/v1/suppliers", label: "supplier", entityType: "Supplier", auditPrefix: "suppliers",
  model: (c) => c.supplier as never,
  permissions: { read: ["suppliers.manage", "purchasing.view", "purchasing.create", "invoices.manage"], write: "suppliers.manage" },
  createSchema: supplierInputSchema, updateSchema: supplierUpdateSchema,
  searchFields: ["name", "code", "contactName", "email", "phone"], sortable: ["name", "code", "paymentTermsDays"], defaultSort: "name",
  filters: { isActive: boolQuery.optional() },
  prepare: (input) => ({ ...input, ...(input.email === "" ? { email: null } : {}) }),
});

export const supplierItemsRouter = defineResource({
  mount: "/api/v1/supplier-items", label: "supplier item", entityType: "SupplierItem", auditPrefix: "suppliers.items", hardDelete: true,
  model: (c) => c.supplierItem as never,
  permissions: { read: ["suppliers.manage", "purchasing.view", "purchasing.create"], write: "suppliers.manage" },
  createSchema: supplierItemInputSchema, updateSchema: supplierItemUpdateSchema,
  searchFields: ["supplierSku", "packName"], sortable: ["packName", "priceMinor"], defaultSort: "packName",
  filters: { supplierId: idSchema.optional(), itemId: idSchema.optional() },
  include: { item: { select: { id: true, name: true, unit: true } } },
  prepare: async (input, { tx, existing }) => {
    if (input.supplierId) await assertRef(tx.supplier, input.supplierId, "supplier");
    if (input.itemId) await assertRef(tx.inventoryItem, input.itemId, "item");
    if (input.isPreferred) {
      // one preferred supplier per item
      const itemId = input.itemId ?? existing?.itemId;
      await tx.supplierItem.updateMany({ where: { itemId, ...(existing ? { id: { not: existing.id } } : {}) }, data: { isPreferred: false } });
    }
    return input;
  },
});

// ---------------------------------------------------------------- purchase orders
const orders = securedRouter("/api/v1/purchase-orders");

const orderInclude = {
  supplier: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  lines: { include: { item: { select: { name: true, unit: true } } } },
} as const;

orders.get("/", "purchasing.view", async (req, res) => {
  const q = listQuery.extend({ status: z.enum(["DRAFT", "APPROVED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]).optional(), supplierId: idSchema.optional(), locationId: idSchema.optional() }).parse(req.query);
  const where = { ...(q.status && { status: q.status }), ...(q.supplierId && { supplierId: q.supplierId }), ...(q.locationId && { locationId: q.locationId }), ...(q.q && { number: { contains: q.q, mode: "insensitive" as const } }) };
  const [rows, total] = await Promise.all([
    db.purchaseOrder.findMany({ where, orderBy: { createdAt: "desc" }, ...paging(q), include: { supplier: { select: { name: true } }, location: { select: { name: true } }, lines: { select: { id: true } } } }),
    db.purchaseOrder.count({ where }),
  ]);
  res.json({ data: rows.map(({ supplier, location, lines, ...o }) => ({ ...o, supplierName: supplier.name, locationName: location.name, lineCount: lines.length })), meta: offsetMeta(q, total) });
});

orders.get("/:id", "purchasing.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const order = await db.purchaseOrder.findFirst({ where: { id }, include: orderInclude });
  if (!order) throw notFound("purchase order");
  res.json({ data: order });
});

/** Turn the request's lines into rows: pack size and name come from the supplier's catalogue unless given. */
async function buildLines(tx: Tx, supplierId: string, lines: z.infer<typeof purchaseOrderInputSchema>["lines"]) {
  const ids = lines.map((l) => l.itemId);
  if (new Set(ids).size !== ids.length) throw fieldError("lines", "An item appears twice");
  const [items, catalogue] = await Promise.all([
    tx.inventoryItem.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } }),
    tx.supplierItem.findMany({ where: { supplierId, itemId: { in: ids }, isActive: true } }),
  ]);
  if (items.length !== ids.length) throw fieldError("lines", "One of the items does not exist");
  return lines.map((l) => {
    const known = catalogue.find((c) => c.itemId === l.itemId && (!l.packName || c.packName === l.packName));
    const packName = l.packName ?? known?.packName ?? "Each";
    const packQty = l.packQty ?? (known ? Number(known.packQty) : 1);
    return { itemId: l.itemId, packName, packQty, orderedPacks: l.orderedPacks, unitPriceMinor: l.unitPriceMinor, lineTotalMinor: Math.round(l.orderedPacks * l.unitPriceMinor) };
  });
}

orders.post("/", "purchasing.create", async (req, res) => {
  const input = purchaseOrderInputSchema.parse(req.body);
  const created = await db.$transaction(async (tx) => {
    const location = await requireLocation(tx, input.locationId);
    await assertRef(tx.supplier, input.supplierId, "supplier", { deletedAt: null });
    const lines = await buildLines(tx, input.supplierId, input.lines);
    const po = await tx.purchaseOrder.create({
      data: { tenantId: ctx().tenantId, locationId: location.id, supplierId: input.supplierId, number: documentNumber("PO"), currencyCode: location.currencyCode, expectedDate: input.expectedDate ? asDate(input.expectedDate) : null, note: input.note ?? null, totalMinor: lines.reduce((s, l) => s + l.lineTotalMinor, 0), createdById: ctx().userId },
    });
    await tx.purchaseOrderLine.createMany({ data: lines.map((l) => ({ tenantId: ctx().tenantId, orderId: po.id, ...l })) });
    await recordAudit(tx, { action: "purchasing.order.create", entityType: "PurchaseOrder", entityId: po.id, locationId: location.id, after: { number: po.number, totalMinor: po.totalMinor, lines: lines.length } });
    return po;
  });
  res.status(201).json({ data: created });
});

/** A draft can be edited freely; once approved it is fixed (cancel and raise a new one). */
orders.put("/:id", "purchasing.create", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = purchaseOrderInputSchema.parse(req.body);
  const saved = await db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({ where: { id } });
    if (!po) throw notFound("purchase order");
    if (po.status !== "DRAFT") throw conflict("Only a draft can be edited. Cancel this order and raise a new one.");
    await assertRef(tx.supplier, input.supplierId, "supplier", { deletedAt: null });
    const lines = await buildLines(tx, input.supplierId, input.lines);
    await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
    await tx.purchaseOrderLine.createMany({ data: lines.map((l) => ({ tenantId: ctx().tenantId, orderId: id, ...l })) });
    const after = await tx.purchaseOrder.update({ where: { id }, data: { supplierId: input.supplierId, expectedDate: input.expectedDate ? asDate(input.expectedDate) : null, note: input.note ?? null, totalMinor: lines.reduce((s, l) => s + l.lineTotalMinor, 0) } });
    await recordAudit(tx, { action: "purchasing.order.update", entityType: "PurchaseOrder", entityId: id, locationId: po.locationId, before: { totalMinor: po.totalMinor }, after: { totalMinor: after.totalMinor } });
    return after;
  });
  res.json({ data: saved });
});

const moveStatus = (path: string, perm: "purchasing.approve" | "purchasing.create", from: string[], to: "APPROVED" | "SENT" | "CANCELLED", action: string) =>
  orders.post(path, perm, async (req, res) => {
    const { id } = idParams.parse(req.params);
    await db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({ where: { id }, include: { lines: true } });
      if (!po) throw notFound("purchase order");
      if (!from.includes(po.status)) throw conflict(`A ${po.status.toLowerCase().replace(/_/g, " ")} order cannot be ${action}`);
      if (to === "CANCELLED" && po.lines.some((l) => Number(l.receivedPacks) > 0)) throw conflict("Goods have already arrived against this order. Receive the rest or leave it open.");
      await tx.purchaseOrder.update({ where: { id }, data: { status: to, ...(to === "APPROVED" && { approvedById: ctx().userId, approvedAt: new Date() }), ...(to === "SENT" && { sentAt: new Date() }) } });
      await recordAudit(tx, { action: `purchasing.order.${to.toLowerCase()}`, entityType: "PurchaseOrder", entityId: id, locationId: po.locationId, before: { status: po.status }, after: { status: to } });
    });
    res.json({ data: { status: to } });
  });
moveStatus("/:id/approve", "purchasing.approve", ["DRAFT"], "APPROVED", "approved");
moveStatus("/:id/send", "purchasing.create", ["APPROVED"], "SENT", "sent");
moveStatus("/:id/cancel", "purchasing.create", ["DRAFT", "APPROVED", "SENT"], "CANCELLED", "cancelled");

/** Goods arrive: stock goes up at the order's price, and the order moves to partly or fully received. */
orders.post("/:id/receive", "purchasing.receive", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = receiveInputSchema.parse(req.body);
  const out = await db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({ where: { id }, include: { lines: true } });
    if (!po) throw notFound("purchase order");
    if (!["APPROVED", "SENT", "PARTIALLY_RECEIVED"].includes(po.status)) throw conflict("This order is not waiting for goods");
    const arriving = input.lines.filter((l) => l.packs > 0);
    if (arriving.length === 0) throw fieldError("lines", "Enter how much arrived");

    const receipt = await tx.goodsReceipt.create({ data: { tenantId: ctx().tenantId, locationId: po.locationId, supplierId: po.supplierId, orderId: po.id, number: documentNumber("GRN"), note: input.note ?? null, receivedById: ctx().userId } });
    const rows: { tenantId: string; receiptId: string; itemId: string; packs: number; qty: number; unitCost: number; totalMinor: number }[] = [];
    for (const l of arriving) {
      const line = po.lines.find((x) => x.itemId === l.itemId);
      if (!line) throw fieldError("lines", "That item is not on this order");
      const remaining = Number(line.orderedPacks) - Number(line.receivedPacks);
      if (l.packs > remaining + 1e-9) throw fieldError("lines", `Only ${round3(remaining)} ${line.packName} left to receive`);
      const qty = round3(l.packs * Number(line.packQty));
      const unitCost = round6(line.unitPriceMinor / Number(line.packQty));
      await postMovement(tx, { locationId: po.locationId, itemId: l.itemId, type: "PURCHASE", qty, unitCost, reason: `Receipt from ${po.number}`, refType: "RECEIPT", refId: receipt.id });
      await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedPacks: round3(Number(line.receivedPacks) + l.packs) } });
      rows.push({ tenantId: ctx().tenantId, receiptId: receipt.id, itemId: l.itemId, packs: l.packs, qty, unitCost, totalMinor: Math.round(l.packs * line.unitPriceMinor) });
      // keep the supplier's catalogue price in step with what we actually paid
      await tx.supplierItem.updateMany({ where: { supplierId: po.supplierId, itemId: l.itemId, packName: line.packName }, data: { priceMinor: line.unitPriceMinor } });
    }
    await tx.goodsReceiptLine.createMany({ data: rows });
    const after = await tx.purchaseOrderLine.findMany({ where: { orderId: id } });
    const complete = after.every((l) => Number(l.receivedPacks) + 1e-9 >= Number(l.orderedPacks));
    await tx.purchaseOrder.update({ where: { id }, data: { status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED" } });
    await recordAudit(tx, { action: "purchasing.receive", entityType: "PurchaseOrder", entityId: id, locationId: po.locationId, after: { receipt: receipt.number, lines: rows.length, status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED" } });
    return { receiptId: receipt.id, number: receipt.number, status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED" };
  });
  res.status(201).json({ data: out });
});

// ---------------------------------------------------------------- goods receipts
const receipts = securedRouter("/api/v1/goods-receipts");

receipts.get("/", "purchasing.view", async (req, res) => {
  const q = listQuery.extend({ locationId: idSchema.optional(), supplierId: idSchema.optional() }).parse(req.query);
  const where = { ...(q.locationId && { locationId: q.locationId }), ...(q.supplierId && { supplierId: q.supplierId }), ...(q.q && { number: { contains: q.q, mode: "insensitive" as const } }) };
  const [rows, total] = await Promise.all([
    db.goodsReceipt.findMany({ where, orderBy: { receivedAt: "desc" }, ...paging(q), include: { supplier: { select: { name: true } }, location: { select: { name: true } }, order: { select: { number: true } }, lines: { select: { totalMinor: true } } } }),
    db.goodsReceipt.count({ where }),
  ]);
  res.json({ data: rows.map(({ supplier, location, order, lines, ...r }) => ({ ...r, supplierName: supplier.name, locationName: location.name, orderNumber: order?.number ?? null, lineCount: lines.length, totalMinor: lines.reduce((s, l) => s + l.totalMinor, 0) })), meta: offsetMeta(q, total) });
});

receipts.get("/:id", "purchasing.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const r = await db.goodsReceipt.findFirst({ where: { id }, include: { supplier: { select: { name: true } }, location: { select: { name: true } }, order: { select: { number: true } }, lines: { include: { item: { select: { name: true, unit: true } } } } } });
  if (!r) throw notFound("receipt");
  res.json({ data: r });
});

/** Goods that turned up without an order (a market run, a top-up). Same effect on stock. */
receipts.post("/direct", "purchasing.receive", async (req, res) => {
  const input = directReceiptSchema.parse(req.body);
  const out = await db.$transaction(async (tx) => {
    const location = await requireLocation(tx, input.locationId);
    await assertRef(tx.supplier, input.supplierId, "supplier", { deletedAt: null });
    const ids = input.lines.map((l) => l.itemId);
    if (new Set(ids).size !== ids.length) throw fieldError("lines", "An item appears twice");
    if ((await tx.inventoryItem.count({ where: { id: { in: ids }, deletedAt: null } })) !== ids.length) throw fieldError("lines", "One of the items does not exist");
    const receipt = await tx.goodsReceipt.create({ data: { tenantId: ctx().tenantId, locationId: location.id, supplierId: input.supplierId, number: documentNumber("GRN"), note: input.note ?? null, receivedById: ctx().userId } });
    const rows = [];
    for (const l of input.lines) {
      const packQty = l.packQty ?? 1;
      const qty = round3(l.packs * packQty);
      const unitCost = round6(l.unitPriceMinor / packQty);
      await postMovement(tx, { locationId: location.id, itemId: l.itemId, type: "PURCHASE", qty, unitCost, reason: "Direct receipt", refType: "RECEIPT", refId: receipt.id });
      rows.push({ tenantId: ctx().tenantId, receiptId: receipt.id, itemId: l.itemId, packs: l.packs, qty, unitCost, totalMinor: Math.round(l.packs * l.unitPriceMinor) });
    }
    await tx.goodsReceiptLine.createMany({ data: rows });
    await recordAudit(tx, { action: "purchasing.receive.direct", entityType: "GoodsReceipt", entityId: receipt.id, locationId: location.id, after: { number: receipt.number, lines: rows.length } });
    return { id: receipt.id, number: receipt.number };
  });
  res.status(201).json({ data: out });
});

// ---------------------------------------------------------------- supplier invoices and payments
const invoices = securedRouter("/api/v1/supplier-invoices");

const withOutstanding = <T extends { totalMinor: number; paidMinor: number; status: string; dueDate: Date }>(i: T, today: string) => ({
  ...i, outstandingMinor: i.status === "VOID" ? 0 : i.totalMinor - i.paidMinor,
  overdue: (i.status === "OPEN" || i.status === "PARTIALLY_PAID") && isoDay(i.dueDate) < today,
});

invoices.get("/", "invoices.manage", async (req, res) => {
  const q = listQuery.extend({ status: z.enum(["OPEN", "PARTIALLY_PAID", "PAID", "VOID"]).optional(), supplierId: idSchema.optional(), unpaid: boolQuery.optional() }).parse(req.query);
  const where = {
    ...(q.status && { status: q.status }), ...(q.supplierId && { supplierId: q.supplierId }),
    ...(q.unpaid && { status: { in: ["OPEN", "PARTIALLY_PAID"] as ("OPEN" | "PARTIALLY_PAID")[] } }),
    ...(q.q && { invoiceNo: { contains: q.q, mode: "insensitive" as const } }),
  };
  const [rows, total] = await Promise.all([
    db.supplierInvoice.findMany({ where, orderBy: { dueDate: "asc" }, ...paging(q), include: { supplier: { select: { name: true } } } }),
    db.supplierInvoice.count({ where }),
  ]);
  const today = isoDay(new Date());
  res.json({ data: rows.map(({ supplier, ...i }) => ({ ...withOutstanding(i, today), supplierName: supplier.name })), meta: offsetMeta(q, total) });
});

/** What we owe each supplier, and how much of it is past due. */
invoices.get("/payables", "invoices.manage", async (_req, res) => {
  const open = await db.supplierInvoice.findMany({ where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } }, include: { supplier: { select: { name: true } } } });
  const today = isoDay(new Date());
  const bySupplier = new Map<string, { supplierId: string; supplierName: string; invoices: number; outstandingMinor: number; overdueMinor: number }>();
  for (const i of open) {
    const row = bySupplier.get(i.supplierId) ?? { supplierId: i.supplierId, supplierName: i.supplier.name, invoices: 0, outstandingMinor: 0, overdueMinor: 0 };
    const owed = i.totalMinor - i.paidMinor;
    row.invoices++; row.outstandingMinor += owed;
    if (isoDay(i.dueDate) < today) row.overdueMinor += owed;
    bySupplier.set(i.supplierId, row);
  }
  const data = [...bySupplier.values()].sort((a, b) => b.outstandingMinor - a.outstandingMinor);
  res.json({ data, meta: { outstandingMinor: data.reduce((s, r) => s + r.outstandingMinor, 0), overdueMinor: data.reduce((s, r) => s + r.overdueMinor, 0) } });
});

invoices.get("/:id", "invoices.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const inv = await db.supplierInvoice.findFirst({ where: { id }, include: { supplier: { select: { name: true } }, payments: { orderBy: { paidAt: "asc" } }, order: { select: { number: true, totalMinor: true } } } });
  if (!inv) throw notFound("invoice");
  res.json({ data: { ...withOutstanding(inv, isoDay(new Date())), supplierName: inv.supplier.name } });
});

invoices.post("/", "invoices.manage", async (req, res) => {
  const input = invoiceInputSchema.parse(req.body);
  const created = await db.$transaction(async (tx) => {
    const supplier = await assertRef(tx.supplier, input.supplierId, "supplier");
    if (input.orderId) await assertRef(tx.purchaseOrder, input.orderId, "order", { supplierId: input.supplierId });
    const due = input.dueDate ?? isoDay(new Date(asDate(input.invoiceDate).getTime() + (supplier!.paymentTermsDays as number) * 86_400_000));
    const inv = await tx.supplierInvoice.create({ data: { tenantId: ctx().tenantId, supplierId: input.supplierId, orderId: input.orderId ?? null, invoiceNo: input.invoiceNo, invoiceDate: asDate(input.invoiceDate), dueDate: asDate(due), totalMinor: input.totalMinor, note: input.note ?? null, createdById: ctx().userId } });
    await recordAudit(tx, { action: "purchasing.invoice.create", entityType: "SupplierInvoice", entityId: inv.id, after: { invoiceNo: inv.invoiceNo, totalMinor: inv.totalMinor } });
    return inv;
  });
  res.status(201).json({ data: created });
});

invoices.post("/:id/payments", "invoices.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = supplierPaymentInputSchema.parse(req.body);
  const out = await db.$transaction(async (tx) => {
    const inv = await tx.supplierInvoice.findFirst({ where: { id } });
    if (!inv) throw notFound("invoice");
    if (inv.status === "VOID" || inv.status === "PAID") throw conflict(inv.status === "PAID" ? "This invoice is already paid" : "This invoice is void");
    const owed = inv.totalMinor - inv.paidMinor;
    if (input.amountMinor > owed) throw fieldError("amountMinor", "That is more than is owed on this invoice");
    await tx.supplierPayment.create({ data: { tenantId: ctx().tenantId, invoiceId: id, amountMinor: input.amountMinor, method: input.method, reference: input.reference ?? null, createdById: ctx().userId } });
    const paidMinor = inv.paidMinor + input.amountMinor;
    const status = paidMinor === inv.totalMinor ? "PAID" : "PARTIALLY_PAID";
    await tx.supplierInvoice.update({ where: { id }, data: { paidMinor, status } });
    await recordAudit(tx, { action: "purchasing.payment", entityType: "SupplierInvoice", entityId: id, after: { amountMinor: input.amountMinor, method: input.method, status } });
    return { paidMinor, outstandingMinor: inv.totalMinor - paidMinor, status };
  });
  res.status(201).json({ data: out });
});

invoices.post("/:id/void", "invoices.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  await db.$transaction(async (tx) => {
    const inv = await tx.supplierInvoice.findFirst({ where: { id } });
    if (!inv) throw notFound("invoice");
    if (inv.paidMinor > 0) throw conflict("Payments have been made against this invoice, so it cannot be voided");
    if (inv.status === "VOID") throw conflict("Already void");
    await tx.supplierInvoice.update({ where: { id }, data: { status: "VOID" } });
    await recordAudit(tx, { action: "purchasing.invoice.void", entityType: "SupplierInvoice", entityId: id });
  });
  res.json({ data: { status: "VOID" } });
});

// ---------------------------------------------------------------- suggested orders
const suggested = securedRouter("/api/v1/suggested-orders");

/**
 * What to buy for one location: everything at or below its reorder level, topped up to its par level (or
 * twice the reorder level when no par is set), from the preferred supplier (otherwise the cheapest one),
 * rounded up to whole packs. Items nobody supplies are listed separately so they are not forgotten.
 */
suggested.get("/", "purchasing.create", async (req, res) => {
  const { locationId } = z.object({ locationId: idSchema }).parse(req.query);
  await requireLocation(db, locationId);
  const [items, levels, catalogue, suppliers] = await Promise.all([
    db.inventoryItem.findMany({ where: { isActive: true, reorderLevel: { not: null } }, orderBy: { name: "asc" } }),
    db.stockLevel.findMany({ where: { locationId } }),
    db.supplierItem.findMany({ where: { isActive: true } }),
    db.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  const onHand = new Map(levels.map((l) => [l.itemId, Number(l.qty)]));
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const groups = new Map<string, { supplierId: string; supplierName: string; lines: unknown[]; totalMinor: number }>();
  const unsourced: { itemId: string; name: string; unit: string; onHand: number; needQty: number }[] = [];

  for (const item of items) {
    const qty = onHand.get(item.id) ?? 0;
    const reorder = Number(item.reorderLevel);
    if (qty > reorder) continue;
    const target = item.parLevel !== null ? Number(item.parLevel) : reorder * 2;
    const need = round3(target - qty);
    if (need <= 0) continue;
    const options = catalogue.filter((c) => c.itemId === item.id && supplierName.has(c.supplierId));
    const pick = options.find((o) => o.isPreferred) ?? [...options].sort((a, b) => a.priceMinor / Number(a.packQty) - b.priceMinor / Number(b.packQty))[0];
    if (!pick) { unsourced.push({ itemId: item.id, name: item.name, unit: item.unit, onHand: qty, needQty: need }); continue; }
    const packs = Math.ceil(need / Number(pick.packQty));
    const g = groups.get(pick.supplierId) ?? { supplierId: pick.supplierId, supplierName: supplierName.get(pick.supplierId)!, lines: [], totalMinor: 0 };
    const lineTotalMinor = packs * pick.priceMinor;
    g.lines.push({ itemId: item.id, name: item.name, unit: item.unit, onHand: qty, reorderLevel: reorder, needQty: need, packName: pick.packName, packQty: Number(pick.packQty), packs, unitPriceMinor: pick.priceMinor, lineTotalMinor });
    g.totalMinor += lineTotalMinor;
    groups.set(pick.supplierId, g);
  }
  res.json({ data: { suppliers: [...groups.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName)), unsourced } });
});

export const purchaseOrdersRouter = orders.router;
export const goodsReceiptsRouter = receipts.router;
export const supplierInvoicesRouter = invoices.router;
export const suggestedOrdersRouter = suggested.router;
