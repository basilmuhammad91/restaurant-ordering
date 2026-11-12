import {
  applyTender, businessDateOf, canTransition, formatOrderNumber, lineVoidInputSchema, idSchema, orderCreateSchema, orderListQuerySchema, orderReplaceSchema,
  orderStatusInputSchema, paymentInputSchema, paymentStatusFor, refundInputSchema, toBasisPoints, type OrderCreateInput, type OrderStatus,
} from "@restoflux/contracts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext } from "../../core/context/context.js";
import { db, type Tx } from "../../core/db/scoped.js";
import { fieldError, forbidden, notFound, validationError } from "../../core/http/errors.js";
import { offsetMeta, paging, parseSort } from "../../core/http/pagination.js";
import { securedRouter } from "../../core/http/secured.js";
import type { Principal } from "../../core/rbac/principal.js";
import { guardAction, hashPayload } from "../approvals/service.js";
import { afterOrderCompleted } from "../customers/hooks.js";
import { assertMinimumSpend, normalizePhone, resolveOffer, type ResolvedOffer } from "../customers/offers.js";
import { consumeForOrder } from "../inventory/stock.js";
import { draftOrder, type OrderDraft } from "./engine.js";
import { asDate, conflictError, loadOrder, nextOrderNumber, orderInclude, repriceOrder, toOrderDto } from "./shared.js";

// ORDERS: create (priced on the server, safe to retry), hold and edit, take payments (split tender,
// change, tips), move through the kitchen, void lines, refund, cancel. Every change is audited, and
// every amount above a person's own limit needs a manager (the approvals module from Phase 1).

const orders = securedRouter("/api/v1/orders");
const idParams = z.object({ id: idSchema });
const tenantId = () => requireContext().tenantId;

const FORWARD_STATUSES = new Set<string>(["PENDING", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"]);

async function reasonOf(tx: Tx, id: string, type: "VOID" | "REFUND" | "DISCOUNT") {
  const reason = await tx.reasonCode.findFirst({ where: { id, type } });
  if (!reason) throw fieldError("reasonId", "Choose one of the listed reasons");
  return reason;
}

async function recordStatus(tx: Tx, orderId: string, from: OrderStatus | null, to: OrderStatus, note?: string | null) {
  await tx.orderStatusEvent.create({ data: { tenantId: tenantId(), orderId, fromStatus: from, toStatus: to, byUserId: requireContext().userId, note: note ?? null } });
}

/** The discount part of an order request: permission, reason, and the manager-approval threshold. */
type DiscountAuth = { reason: { id: string } | null; approvalId: string | null; offer: ResolvedOffer | null };

async function authorizeDiscount(tx: Tx, actor: Principal, orderId: string, input: OrderCreateInput, draft: OrderDraft, offer: ResolvedOffer | null = null): Promise<DiscountAuth | null> {
  const d = input.discount;
  if (!d) return null;
  // a coupon or promotion carries its own authority (the server priced it); no reason, permission or manager approval is involved
  if (offer) return { reason: null, approvalId: null, offer };
  if (!actor.permissions.has("orders.discount")) throw forbidden("You do not have permission to give discounts");
  const reason = await reasonOf(tx, d.reasonId, "DISCOUNT");
  if (reason.requiresNote && !d.note?.trim()) throw fieldError("discount", "This reason needs a note");
  const percent = d.type === "PERCENT" ? d.value : draft.priced.subtotalMinor > 0 ? (d.value / draft.priced.subtotalMinor) * 100 : 0;
  const payload = { orderId, type: d.type, value: d.value, reasonId: d.reasonId };
  const { approvalId } = await guardAction(tx, actor, {
    type: "DISCOUNT", entityType: "Order", entityId: orderId, locationId: input.locationId, percent, payload, payloadHash: hashPayload(payload),
    reason: `${reason.name}${d.note ? `: ${d.note}` : ""}`, approvalId: d.approvalId ?? null,
  });
  return { reason, approvalId, offer: null };
}


/** Lines, modifiers, tax breakdown and discount of an order (used when creating one and when editing a held one). */
async function writeChildren(tx: Tx, args: { id: string; locationId: string; input: OrderCreateInput; draft: OrderDraft; actor: Principal; sent: boolean; now: Date; discountAuth: DiscountAuth | null }) {
  const { id, locationId, input, draft, actor, sent, now, discountAuth } = args;
  const location = { id: locationId };
  const byKey = new Map(draft.priced.lines.map((p) => [p.key, p]));
  await tx.orderLine.createMany({
    data: draft.lines.map((l) => {
      const p = byKey.get(l.id);
      return {
        id: l.id, tenantId: tenantId(), locationId: location.id, orderId: id, parentLineId: l.parentLineId, kind: l.kind, variantId: l.variantId, comboId: l.comboId,
        nameSnapshot: l.name, variantNameSnapshot: l.variantName, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, modifiersTotalMinor: l.modifiersTotalMinor,
        lineSubtotalMinor: p?.subtotalMinor ?? 0, discountMinor: p?.discountMinor ?? 0, taxMinor: p?.taxMinor ?? 0, lineTotalMinor: p?.totalMinor ?? 0,
        stationKey: l.stationKey, status: "NEW" as const, sentToKitchenAt: sent ? now : null, notes: l.notes, sortOrder: l.sortOrder,
      };
    }),
  });
  const modifierRows = draft.lines.flatMap((l) => l.modifiers.map((m) => ({ id: randomUUID(), tenantId: tenantId(), lineId: l.id, optionId: m.optionId, nameSnapshot: m.name, priceMinor: m.priceMinor, quantity: 1 })));
  if (modifierRows.length) await tx.orderLineModifier.createMany({ data: modifierRows });
  const taxRows = draft.priced.lines.flatMap((p) => p.taxLines.map((t) => ({ id: randomUUID(), tenantId: tenantId(), lineId: p.key, ruleId: t.ruleId ?? null, ruleNameSnapshot: t.name, authorityCode: t.authorityCode, rateBp: t.rateBp, baseMinor: t.baseMinor, taxMinor: t.taxMinor, isInclusive: t.isInclusive })));
  if (taxRows.length) await tx.orderLineTax.createMany({ data: taxRows });

  if (input.discount && discountAuth) {
    await tx.orderDiscount.create({
      data: {
        tenantId: tenantId(), orderId: id, source: discountAuth.offer ? discountAuth.offer.kind : "MANUAL", offerId: discountAuth.offer?.id ?? null, valueType: input.discount.type, value: input.discount.type === "PERCENT" ? toBasisPoints(input.discount.value) : Math.round(input.discount.value),
        amountMinor: draft.priced.discountMinor, reasonId: discountAuth.reason?.id ?? null, note: input.discount.note ?? null, appliedById: actor.userId, approvalId: discountAuth.approvalId,
      },
    });
  }
}

/** Write an order and everything that hangs off it, in the caller's transaction. */
async function persistOrder(tx: Tx, args: { id: string; input: OrderCreateInput; draft: OrderDraft; actor: Principal; status: OrderStatus; occurredAt: Date; keepNumber?: number | null; offer?: ResolvedOffer | null }) {
  const { id, input, draft, actor, status, occurredAt } = args;
  const location = await tx.location.findFirst({ where: { id: input.locationId } });
  if (!location || location.type !== "BRANCH" || !location.brandId) throw fieldError("locationId", "Orders can only be taken at a branch");
  if (input.tableId) {
    if (input.orderType !== "DINE_IN") throw fieldError("tableId", "Only dine-in orders have a table");
    if (!(await tx.diningTable.findFirst({ where: { id: input.tableId, locationId: location.id } }))) throw fieldError("tableId", "That table does not exist at this branch");
  }
  if (input.orderType === "DELIVERY" && !input.deliveryAddress) throw fieldError("deliveryAddress", "A delivery order needs an address");

  const businessDate = businessDateOf(occurredAt, location.timezone, location.businessDayStartTime ?? "05:00");
  const displayNumber = args.keepNumber ?? (await nextOrderNumber(tx, location.id, businessDate));
  const now = new Date();
  const sent = status !== "OPEN"; // a held bill has not gone to the kitchen
  const discountAuth = await authorizeDiscount(tx, actor, id, input, draft, args.offer ?? null);

  await tx.order.create({
    data: {
      id, tenantId: tenantId(), brandId: location.brandId, locationId: location.id, businessDate: asDate(businessDate), orderType: input.orderType, channel: input.channel,
      status, paymentStatus: "UNPAID", displayNumber, aggregatorName: input.aggregatorName ?? null, aggregatorRef: input.aggregatorRef ?? null,
      customerName: input.customerName ?? null, customerPhone: normalizePhone(input.customerPhone), tableId: input.tableId ?? null, covers: input.covers ?? null,
      deliveryAddress: input.deliveryAddress ?? undefined, currencyCode: location.currencyCode,
      subtotalMinor: draft.priced.subtotalMinor, discountMinor: draft.priced.discountMinor, taxMinor: draft.priced.taxMinor, deliveryFeeMinor: draft.priced.deliveryFeeMinor,
      totalMinor: draft.priced.totalMinor, pricesIncludeTax: draft.pricesIncludeTax, notes: input.notes ?? null, occurredAt, createdById: actor.userId,
    },
  });

  await writeChildren(tx, { id, locationId: location.id, input, draft, actor, sent, now, discountAuth });
  await recordStatus(tx, id, null, status);
  return { location, displayNumber };
}

const defaultStatus = (input: OrderCreateInput): OrderStatus => input.status ?? (input.channel === "POS" || input.channel === "PHONE" ? "CONFIRMED" : "PENDING");

// ---------------------------------------------------------------- create
orders.post("/", "orders.create", async (req, res) => {
  const parsed = orderCreateSchema.parse(req.body);
  const offer = await resolveOffer(parsed);
  const input: OrderCreateInput = offer ? { ...parsed, discount: offer.discount } : parsed;
  const actor = req.principal!;
  const id = input.id ?? randomUUID();

  // Idempotent: the POS may resend the same order after a dropped connection. The second call finds the first.
  const existing = await db.order.findFirst({ where: { id }, include: orderInclude });
  if (existing) return void res.json({ data: toOrderDto(existing), meta: { replayed: true } });

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw validationError("The order time is in the future", { fieldErrors: { occurredAt: ["The order time is in the future"] } });
  const draft = await draftOrder(input, occurredAt);
  if (offer) assertMinimumSpend(offer, draft.priced.subtotalMinor);

  try {
    const full = await db.$transaction(async (tx) => {
      const status = defaultStatus(input);
      const { location, displayNumber } = await persistOrder(tx, { id, input, draft, actor, status, occurredAt, offer });
      const created = await loadOrder(tx, id);
      await recordAudit(tx, { action: "orders.create", entityType: "Order", entityId: id, locationId: location.id, after: { number: formatOrderNumber(location.orderPrefix, displayNumber), status, totalMinor: created.totalMinor, lines: created.lines.length } });
      return created;
    });
    res.status(201).json({ data: toOrderDto(full), meta: { replayed: false } });
  } catch (e) {
    // two requests with the same id raced: the loser finds the winner's order instead of failing
    if ((e as { code?: string }).code === "P2002") {
      const winner = await db.order.findFirst({ where: { id }, include: orderInclude });
      if (winner) return void res.json({ data: toOrderDto(winner), meta: { replayed: true } });
    }
    throw e;
  }
});

// ---------------------------------------------------------------- list and read
orders.get("/", "orders.view", async (req, res) => {
  const q = orderListQuerySchema.parse(req.query);
  const numeric = q.q && /^\d+$/.test(q.q) ? Number(q.q) : null;
  const where = {
    ...(q.locationId && { locationId: q.locationId }),
    ...(q.status && { status: { in: q.status } }),
    ...(q.active && { status: { notIn: ["COMPLETED", "CANCELLED"] as OrderStatus[] } }),
    ...(q.paymentStatus && { paymentStatus: q.paymentStatus }),
    ...(q.orderType && { orderType: q.orderType }),
    ...(q.channel && { channel: q.channel }),
    ...((q.from || q.to) && { businessDate: { ...(q.from && { gte: asDate(q.from) }), ...(q.to && { lte: asDate(q.to) }) } }),
    ...(q.q && { OR: [{ customerName: { contains: q.q, mode: "insensitive" as const } }, { customerPhone: { contains: q.q } }, ...(numeric !== null ? [{ displayNumber: numeric }] : [])] }),
  };
  const [rows, total] = await Promise.all([
    db.order.findMany({ where, include: orderInclude, orderBy: parseSort(q.sort, ["placedAt", "totalMinor", "displayNumber", "status"], "-placedAt") as never, ...paging(q) }),
    db.order.count({ where }),
  ]);
  res.json({ data: rows.map(toOrderDto), meta: offsetMeta(q, total) });
});

orders.get("/:id", "orders.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json({ data: toOrderDto(await loadOrder(db, id)) });
});

// ---------------------------------------------------------------- edit a held bill
orders.put("/:id", "orders.update", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const parsed = { ...orderReplaceSchema.parse(req.body), id } as OrderCreateInput;
  const offer = await resolveOffer(parsed);
  const input: OrderCreateInput = offer ? { ...parsed, discount: offer.discount } : parsed;
  const actor = req.principal!;

  const before = await loadOrder(db, id);
  if (before.status !== "OPEN") throw conflictError("Only a held order can be changed. Void a line or refund instead.");
  if (before.locationId !== input.locationId) throw fieldError("locationId", "An order cannot move to another branch");
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : before.occurredAt;
  const draft = await draftOrder(input, occurredAt);
  if (offer) assertMinimumSpend(offer, draft.priced.subtotalMinor);

  const full = await db.$transaction(async (tx) => {
    const status = defaultStatus(input);
    const discountAuth = await authorizeDiscount(tx, actor, id, input, draft, offer);
    // the contents are replaced; the order itself (id, number, history) stays
    await tx.orderDiscount.deleteMany({ where: { orderId: id } });
    const lineIds = (await tx.orderLine.findMany({ where: { orderId: id }, select: { id: true } })).map((l) => l.id);
    await tx.orderLineTax.deleteMany({ where: { lineId: { in: lineIds } } });
    await tx.orderLineModifier.deleteMany({ where: { lineId: { in: lineIds } } });
    await tx.orderLine.deleteMany({ where: { orderId: id } });
    await tx.order.update({
      where: { id },
      data: {
        orderType: input.orderType, channel: input.channel, status, customerName: input.customerName ?? null, customerPhone: normalizePhone(input.customerPhone),
        tableId: input.tableId ?? null, covers: input.covers ?? null, notes: input.notes ?? null, deliveryAddress: input.deliveryAddress ?? undefined,
        subtotalMinor: draft.priced.subtotalMinor, discountMinor: draft.priced.discountMinor, taxMinor: draft.priced.taxMinor, deliveryFeeMinor: draft.priced.deliveryFeeMinor,
        totalMinor: draft.priced.totalMinor, pricesIncludeTax: draft.pricesIncludeTax,
      },
    });
    await writeChildren(tx, { id, locationId: before.locationId, input, draft, actor, sent: status !== "OPEN", now: new Date(), discountAuth });
    if (status !== "OPEN") await recordStatus(tx, id, "OPEN", status);
    const after = await loadOrder(tx, id);
    await recordAudit(tx, { action: "orders.update", entityType: "Order", entityId: id, locationId: before.locationId, before: { totalMinor: before.totalMinor, lines: before.lines.length }, after: { totalMinor: after.totalMinor, lines: after.lines.length, status } });
    return after;
  });
  res.json({ data: toOrderDto(full) });
});

// ---------------------------------------------------------------- status
orders.post("/:id/status", ["orders.update", "orders.cancel"], async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = orderStatusInputSchema.parse(req.body);
  const actor = req.principal!;

  const full = await db.$transaction(async (tx) => {
    const order = await loadOrder(tx, id);
    const from = order.status as OrderStatus;
    const to = input.status;
    if (!canTransition(from, to)) throw conflictError(`An order that is ${from.toLowerCase().replace(/_/g, " ")} cannot become ${to.toLowerCase().replace(/_/g, " ")}`);
    if (to === "CANCELLED" ? !actor.permissions.has("orders.cancel") : !actor.permissions.has("orders.update")) throw forbidden();
    const now = new Date();

    if (to === "CANCELLED") {
      if (order.paidMinor > 0) throw conflictError("This order has been paid. Refund it first, then cancel.");
      if (!input.reasonId) throw fieldError("reasonId", "Say why the order is cancelled");
      const reason = await reasonOf(tx, input.reasonId, "VOID");
      if (reason.requiresNote && !input.note?.trim()) throw fieldError("note", "This reason needs a note");
      // cancelling something already sent to the kitchen is a void of its value: above the person's limit it needs a manager
      let approvalId: string | null = null;
      if (from !== "OPEN") {
        const payload = { orderId: id, action: "cancel" };
        approvalId = (await guardAction(tx, actor, { type: "VOID", entityType: "Order", entityId: id, locationId: order.locationId, amountMinor: order.totalMinor, currencyCode: order.currencyCode, payload, payloadHash: hashPayload(payload), reason: `Cancel order: ${reason.name}`, approvalId: input.approvalId ?? null })).approvalId;
      }
      await tx.order.update({ where: { id }, data: { status: to, cancelledAt: now, cancelReasonId: reason.id, cancelNote: input.note ?? null } });
      await tx.orderLine.updateMany({ where: { orderId: id, status: { not: "VOIDED" } }, data: { status: "VOIDED", voidedAt: now, voidedById: actor.userId, voidReasonId: reason.id, voidApprovalId: approvalId } });
      await recordStatus(tx, id, from, to, input.note);
      await recordAudit(tx, { action: "orders.cancel", entityType: "Order", entityId: id, locationId: order.locationId, reason: reason.name, before: { status: from }, after: { status: to, totalMinor: order.totalMinor, wasSentToKitchen: from !== "OPEN" } });
    } else {
      if (to === "COMPLETED" && order.paidMinor < order.totalMinor) throw conflictError("Take payment before completing the order");
      const data: Record<string, unknown> = { status: to };
      if (to === "COMPLETED") data.completedAt = now;
      await tx.order.update({ where: { id }, data });
      if (from === "OPEN" && FORWARD_STATUSES.has(to)) await tx.orderLine.updateMany({ where: { orderId: id, status: { not: "VOIDED" } }, data: { sentToKitchenAt: now } });
      if (to === "PREPARING") await tx.orderLine.updateMany({ where: { orderId: id, status: "NEW" }, data: { status: "PREPARING" } });
      if (to === "READY") await tx.orderLine.updateMany({ where: { orderId: id, status: { in: ["NEW", "PREPARING"] } }, data: { status: "READY", readyAt: now } });
      if (to === "COMPLETED") {
        await tx.orderLine.updateMany({ where: { orderId: id, status: { in: ["NEW", "PREPARING", "READY"] } }, data: { status: "SERVED" } });
        await consumeForOrder(tx, id); // ingredients leave stock in the same transaction
        await afterOrderCompleted(tx, id); // coupons counted, customer remembered, loyalty points earned
      }
      await recordStatus(tx, id, from, to, input.note);
      await recordAudit(tx, { action: "orders.status", entityType: "Order", entityId: id, locationId: order.locationId, before: { status: from }, after: { status: to } });
    }
    return loadOrder(tx, id);
  });
  res.json({ data: toOrderDto(full) });
});

// ---------------------------------------------------------------- payments
orders.post("/:id/payments", "payments.take", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = paymentInputSchema.parse(req.body);
  const actor = req.principal!;
  const paymentId = input.id ?? randomUUID();

  const prior = await db.payment.findFirst({ where: { id: paymentId } });
  if (prior) return void res.json({ data: toOrderDto(await loadOrder(db, id)), meta: { replayed: true, paymentId } });

  const result = await db.$transaction(async (tx) => {
    const order = await loadOrder(tx, id);
    if (order.status === "OPEN") throw conflictError("Send the held order to the kitchen before taking payment");
    if (order.status === "CANCELLED") throw conflictError("A cancelled order cannot be paid");
    const due = order.totalMinor - order.paidMinor;
    if (due <= 0) throw conflictError("This order is already fully paid");

    const method = await tx.paymentMethod.findFirst({ where: { id: input.paymentMethodId, isActive: true } });
    if (!method) throw fieldError("paymentMethodId", "Choose one of the listed payment methods");
    const enabledHere = await tx.locationPaymentMethod.findFirst({ where: { locationId: order.locationId, paymentMethodId: method.id, isEnabled: true } });
    if (!enabledHere) throw fieldError("paymentMethodId", `${method.name} is not accepted at this branch`);
    if (method.requiresReference && !input.reference?.trim()) throw fieldError("reference", `${method.name} needs a reference (the slip or transaction number)`);

    const isCash = method.type === "CASH";
    const shift = await tx.cashShift.findFirst({ where: { locationId: order.locationId, status: "OPEN" }, orderBy: { openedAt: "desc" } });
    if (isCash && !shift) throw conflictError("Open a cash shift before taking cash");

    let applied: { appliedMinor: number; changeMinor: number };
    try {
      applied = applyTender({ dueMinor: due, tenderedMinor: input.tenderedMinor, isCash });
    } catch (e) {
      throw fieldError("tenderedMinor", (e as Error).message);
    }
    const tip = input.tipMinor ?? 0;
    const paid = order.paidMinor + applied.appliedMinor;
    await tx.payment.create({
      data: {
        id: paymentId, tenantId: tenantId(), locationId: order.locationId, orderId: id, businessDate: order.businessDate, paymentMethodId: method.id, amountMinor: applied.appliedMinor,
        tenderedMinor: input.tenderedMinor, changeMinor: applied.changeMinor, tipMinor: tip, currencyCode: order.currencyCode, reference: input.reference?.trim() || null,
        cashShiftId: shift?.id ?? null, receivedById: actor.userId,
      },
    });
    await tx.order.update({ where: { id }, data: { paidMinor: paid, tipMinor: order.tipMinor + tip, paymentStatus: paymentStatusFor(order.totalMinor, paid, order.refundedMinor), cashShiftId: order.cashShiftId ?? shift?.id ?? null } });
    await recordAudit(tx, { action: "payments.take", entityType: "Order", entityId: id, locationId: order.locationId, after: { paymentId, method: method.name, amountMinor: applied.appliedMinor, changeMinor: applied.changeMinor, tipMinor: tip, paidMinor: paid, totalMinor: order.totalMinor } });
    return { order: await loadOrder(tx, id), change: applied.changeMinor };
  });
  res.status(201).json({ data: toOrderDto(result.order), meta: { replayed: false, paymentId, changeMinor: result.change } });
});

// ---------------------------------------------------------------- void a line
orders.post("/:id/lines/:lineId/void", "orders.void", async (req, res) => {
  const { id, lineId } = z.object({ id: idSchema, lineId: idSchema }).parse(req.params);
  const input = lineVoidInputSchema.parse(req.body);
  const actor = req.principal!;

  const full = await db.$transaction(async (tx) => {
    const order = await loadOrder(tx, id);
    if (order.status === "CANCELLED" || order.status === "COMPLETED") throw conflictError("This order is closed. Refund it instead.");
    const line = order.lines.find((l) => l.id === lineId);
    if (!line) throw notFound("order line");
    if (line.kind === "COMBO_ITEM") throw conflictError("Void the whole combo, not one part of it");
    if (line.status === "VOIDED") throw conflictError("This line is already voided");

    const reason = await reasonOf(tx, input.reasonId, "VOID");
    if (reason.requiresNote && !input.note?.trim()) throw fieldError("note", "This reason needs a note");

    // what the order would be worth without this line: refuse first if the customer has already paid more than that
    const remaining = order.lines.filter((l) => l.status !== "VOIDED" && l.id !== lineId && l.parentLineId !== lineId && l.kind !== "COMBO_ITEM");
    const sentToKitchen = line.sentToKitchenAt !== null && order.status !== "OPEN";
    const payload = { orderId: id, lineId };
    const { approvalId } = await guardAction(tx, actor, { type: "VOID", entityType: "Order", entityId: id, locationId: order.locationId, amountMinor: line.lineTotalMinor, currencyCode: order.currencyCode, payload, payloadHash: hashPayload(payload), reason: `Void ${line.nameSnapshot}: ${reason.name}`, approvalId: input.approvalId ?? null });

    const now = new Date();
    await tx.orderLine.updateMany({ where: { OR: [{ id: lineId }, { parentLineId: lineId }] }, data: { status: "VOIDED", voidedAt: now, voidedById: actor.userId, voidReasonId: reason.id, voidNote: input.note ?? null, voidApprovalId: approvalId } });

    if (remaining.length === 0) {
      if (order.paidMinor > 0) throw conflictError("This is the last item on a paid order. Refund the order instead.");
      await tx.order.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now, cancelReasonId: reason.id, cancelNote: "All items voided", subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 } });
      await recordStatus(tx, id, order.status as OrderStatus, "CANCELLED", "All items voided");
    } else {
      const { priced } = await repriceOrder(tx, id, { dryRun: true });
      if (priced.totalMinor < order.paidMinor) throw conflictError("This order has already been paid. Refund the difference instead of voiding the item.");
      await repriceOrder(tx, id);
    }
    await recordAudit(tx, { action: "orders.void", entityType: "Order", entityId: id, locationId: order.locationId, reason: reason.name, after: { lineId, name: line.nameSnapshot, quantity: line.quantity, amountMinor: line.lineTotalMinor, wasSentToKitchen: sentToKitchen, approvalId } });
    return loadOrder(tx, id);
  });
  res.json({ data: toOrderDto(full) });
});

// ---------------------------------------------------------------- refund
orders.post("/:id/refund", "orders.refund", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = refundInputSchema.parse(req.body);
  const actor = req.principal!;

  const full = await db.$transaction(async (tx) => {
    const order = await loadOrder(tx, id);
    const refundable = order.paidMinor - order.refundedMinor;
    if (refundable <= 0) throw conflictError("There is nothing left to refund on this order");
    if (input.amountMinor > refundable) throw fieldError("amountMinor", "That is more than was paid and not yet refunded");
    const reason = await reasonOf(tx, input.reasonId, "REFUND");
    if (reason.requiresNote && !input.note?.trim()) throw fieldError("note", "This reason needs a note");
    const method = await tx.paymentMethod.findFirst({ where: { id: input.paymentMethodId } });
    if (!method) throw fieldError("paymentMethodId", "Choose one of the listed payment methods");
    const shift = await tx.cashShift.findFirst({ where: { locationId: order.locationId, status: "OPEN" }, orderBy: { openedAt: "desc" } });
    if (method.type === "CASH" && !shift) throw conflictError("Open a cash shift to refund in cash");

    const payload = { orderId: id, amountMinor: input.amountMinor, paymentMethodId: input.paymentMethodId };
    const { approvalId } = await guardAction(tx, actor, { type: "REFUND", entityType: "Order", entityId: id, locationId: order.locationId, amountMinor: input.amountMinor, currencyCode: order.currencyCode, payload, payloadHash: hashPayload(payload), reason: reason.name, approvalId: input.approvalId ?? null });

    const refunded = order.refundedMinor + input.amountMinor;
    await tx.refund.create({
      data: {
        tenantId: tenantId(), locationId: order.locationId, orderId: id, businessDate: asDate(businessDateOf(new Date(), order.location.timezone)), amountMinor: input.amountMinor,
        paymentMethodId: method.id, reasonId: reason.id, note: input.note ?? null, cashShiftId: shift?.id ?? null, requestedById: actor.userId, approvalId,
      },
    });
    await tx.order.update({ where: { id }, data: { refundedMinor: refunded, paymentStatus: paymentStatusFor(order.totalMinor, order.paidMinor, refunded) } });
    await recordAudit(tx, { action: "orders.refund", entityType: "Order", entityId: id, locationId: order.locationId, reason: reason.name, after: { amountMinor: input.amountMinor, method: method.name, refundedMinor: refunded, approvalId } });
    return loadOrder(tx, id);
  });
  res.status(201).json({ data: toOrderDto(full) });
});

export const ordersRouter = orders.router;
