import {
  couponCheckSchema, couponInputSchema, couponUpdateSchema, customerInputSchema, customerUpdateSchema, feedbackInputSchema, feedbackReplySchema, idSchema,
  loyaltyAdjustSchema, loyaltyProgramSchema, loyaltyRedeemSchema, promotionInputSchema, promotionUpdateSchema,
} from "@restoflux/contracts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext } from "../../core/context/context.js";
import { db } from "../../core/db/scoped.js";
import { AppError, fieldError, notFound } from "../../core/http/errors.js";
import { offsetMeta, paging } from "../../core/http/pagination.js";
import { assertRef, boolQuery, defineResource } from "../../core/http/resource.js";
import { securedRouter } from "../../core/http/secured.js";
import { localParts, normalizePhone, promotionProblem } from "./offers.js";

const ctx = () => requireContext();
const idParams = z.object({ id: idSchema });
const conflict = (message: string) => new AppError(409, "CONFLICT", message);
const asDate = (yyyyMmDd: string | null | undefined) => (yyyyMmDd ? new Date(`${yyyyMmDd}T00:00:00.000Z`) : null);
const listQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });

// ---------------------------------------------------------------- customers
export const customersRouter = defineResource({
  mount: "/api/v1/customers", label: "customer", entityType: "Customer", auditPrefix: "customers",
  model: (c) => c.customer as never,
  permissions: { read: "customers.view", write: "customers.manage" },
  createSchema: customerInputSchema, updateSchema: customerUpdateSchema,
  searchFields: ["name", "phone", "email"], sortable: ["name", "createdAt", "loyaltyPoints"], defaultSort: "name",
  filters: { marketingOptIn: boolQuery.optional() },
  prepare: (input) => ({
    ...input,
    ...(input.phone !== undefined && { phone: normalizePhone(input.phone) }),
    ...(input.email === "" && { email: null }),
    ...(input.birthday !== undefined && { birthday: asDate(input.birthday) }),
  }),
});

const customerExtras = securedRouter("/api/v1/customers");

/** One customer's history: what they bought (matched by phone), their points, and what they said. */
customerExtras.get("/:id/profile", "customers.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const c = await db.customer.findFirst({ where: { id } });
  if (!c) throw notFound("customer");
  const orders = c.phone ? await db.order.findMany({ where: { customerPhone: c.phone, status: { not: "CANCELLED" } }, orderBy: { placedAt: "desc" }, take: 500, select: { id: true, displayNumber: true, placedAt: true, status: true, totalMinor: true, currencyCode: true, orderType: true, location: { select: { name: true, orderPrefix: true } } } }) : [];
  const done = orders.filter((o) => o.status === "COMPLETED");
  const spend: Record<string, number> = {};
  for (const o of done) spend[o.currencyCode] = (spend[o.currencyCode] ?? 0) + o.totalMinor;
  const [ledger, feedback] = await Promise.all([
    db.loyaltyTransaction.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.feedback.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  res.json({
    data: {
      customer: c, orderCount: done.length, spendByCurrency: spend, lastOrderAt: orders[0]?.placedAt ?? null,
      averageOrderMinor: Object.fromEntries(Object.entries(spend).map(([cur, total]) => [cur, Math.round(total / done.filter((o) => o.currencyCode === cur).length)])),
      recentOrders: orders.slice(0, 10).map((o) => ({ id: o.id, number: `${o.location.orderPrefix ? `${o.location.orderPrefix}-` : ""}${String(o.displayNumber ?? 0).padStart(4, "0")}`, placedAt: o.placedAt, status: o.status, totalMinor: o.totalMinor, currencyCode: o.currencyCode, orderType: o.orderType, branch: o.location.name })),
      ledger, feedback,
    },
  });
});

/** Add or remove points by hand (a goodwill gesture, or a correction). Needs a reason. */
customerExtras.post("/:id/loyalty", "loyalty.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = loyaltyAdjustSchema.parse(req.body);
  const out = await db.$transaction(async (tx) => {
    const c = await tx.customer.findFirst({ where: { id } });
    if (!c) throw notFound("customer");
    if (c.loyaltyPoints + input.points < 0) throw conflict("That would take the balance below zero");
    const updated = await tx.customer.update({ where: { id }, data: { loyaltyPoints: { increment: input.points } }, select: { loyaltyPoints: true } });
    await tx.loyaltyTransaction.create({ data: { tenantId: ctx().tenantId, customerId: id, type: "ADJUST", points: input.points, balanceAfter: updated.loyaltyPoints, note: input.note, createdById: ctx().userId } });
    await recordAudit(tx, { action: "loyalty.adjust", entityType: "Customer", entityId: id, reason: input.note, after: { points: input.points, balance: updated.loyaltyPoints } });
    return { balance: updated.loyaltyPoints };
  });
  res.status(201).json({ data: out });
});

/** Turn points into a single-use coupon worth their value, tied to this customer's phone number. */
customerExtras.post("/:id/redeem", "customers.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = loyaltyRedeemSchema.parse(req.body);
  const out = await db.$transaction(async (tx) => {
    const c = await tx.customer.findFirst({ where: { id } });
    if (!c) throw notFound("customer");
    if (!c.phone) throw conflict("Add a phone number to this customer first, so the coupon can be matched to them");
    const program = await tx.loyaltyProgram.findFirst({});
    if (!program?.isEnabled) throw conflict("The loyalty programme is switched off");
    if (input.points < program.minRedeemPoints) throw fieldError("points", `The minimum to redeem is ${program.minRedeemPoints} points`);
    if (input.points > c.loyaltyPoints) throw fieldError("points", `This customer only has ${c.loyaltyPoints} points`);
    const valueMinor = input.points * program.redeemValueMinor;
    const code = `LOY-${randomUUID().slice(0, 6).toUpperCase()}`;
    const validTo = new Date(Date.now() + 90 * 86_400_000);
    const coupon = await tx.coupon.create({ data: { tenantId: ctx().tenantId, code, description: `${input.points} loyalty points for ${c.name}`, valueType: "AMOUNT", value: valueMinor, maxUses: 1, validTo: new Date(validTo.toISOString().slice(0, 10) + "T00:00:00.000Z"), customerId: id } });
    const updated = await tx.customer.update({ where: { id }, data: { loyaltyPoints: { decrement: input.points } }, select: { loyaltyPoints: true } });
    await tx.loyaltyTransaction.create({ data: { tenantId: ctx().tenantId, customerId: id, type: "REDEEM", points: -input.points, balanceAfter: updated.loyaltyPoints, note: `Redeemed for coupon ${code}`, createdById: ctx().userId } });
    await recordAudit(tx, { action: "loyalty.redeem", entityType: "Customer", entityId: id, after: { points: input.points, coupon: code, valueMinor } });
    return { code, valueMinor, validTo: coupon.validTo, balance: updated.loyaltyPoints };
  });
  res.status(201).json({ data: out });
});

// ---------------------------------------------------------------- loyalty programme
const loyalty = securedRouter("/api/v1/loyalty");

loyalty.get("/program", ["loyalty.manage", "customers.view"], async (_req, res) => {
  const p = await db.loyaltyProgram.findFirst({});
  res.json({ data: p ?? { isEnabled: false, earnPerPointMinor: 10000, redeemValueMinor: 100, minRedeemPoints: 100 } });
});

loyalty.put("/program", "loyalty.manage", async (req, res) => {
  const input = loyaltyProgramSchema.parse(req.body);
  const saved = await db.$transaction(async (tx) => {
    const before = await tx.loyaltyProgram.findFirst({});
    const row = before ? await tx.loyaltyProgram.update({ where: { id: before.id }, data: input }) : await tx.loyaltyProgram.create({ data: { tenantId: ctx().tenantId, ...input } });
    await recordAudit(tx, { action: "loyalty.program", entityType: "LoyaltyProgram", entityId: row.id, before, after: row });
    return row;
  });
  res.json({ data: saved });
});

// ---------------------------------------------------------------- coupons and promotions (setup screens)
/** The form works in percent (10 = 10%); the database keeps basis points like order discounts do. */
const toStored = (input: Record<string, any>, existing?: Record<string, any>) => {
  const valueType = input.valueType ?? existing?.valueType;
  const out: Record<string, any> = { ...input };
  if (input.value !== undefined || input.valueType !== undefined) {
    const raw = input.value ?? (existing ? (existing.valueType === "PERCENT" ? existing.value / 100 : existing.value) : 0);
    out.value = valueType === "PERCENT" ? Math.round(raw * 100) : Math.round(raw);
  }
  for (const k of ["validFrom", "validTo"]) if (input[k] !== undefined) out[k] = asDate(input[k]);
  return out;
};

export const couponsRouter = defineResource({
  mount: "/api/v1/coupons", label: "coupon", entityType: "Coupon", auditPrefix: "coupons",
  model: (c) => c.coupon as never,
  permissions: { read: "coupons.manage", write: "coupons.manage" },
  createSchema: couponInputSchema, updateSchema: couponUpdateSchema,
  searchFields: ["code", "description"], sortable: ["code", "createdAt", "usedCount"], defaultSort: "-createdAt",
  filters: { isActive: boolQuery.optional() },
  prepare: (input, { existing }) => ({ ...toStored(input, existing), ...(input.code && { code: String(input.code).toUpperCase() }) }),
});

export const promotionsRouter = defineResource({
  mount: "/api/v1/promotions", label: "promotion", entityType: "Promotion", auditPrefix: "promotions",
  model: (c) => c.promotion as never,
  permissions: { read: "promotions.manage", write: "promotions.manage" },
  createSchema: promotionInputSchema, updateSchema: promotionUpdateSchema,
  searchFields: ["name", "description"], sortable: ["name", "createdAt"], defaultSort: "name",
  filters: { isActive: boolQuery.optional() },
  prepare: (input, { existing }) => toStored(input, existing),
});

// ---------------------------------------------------------------- what the till can offer
const offers = securedRouter("/api/v1/offers");

/** Promotions running right now at a branch, for the POS to show as one-tap buttons. */
offers.get("/promotions", "orders.create", async (req, res) => {
  const { locationId, subtotalMinor } = z.object({ locationId: idSchema, subtotalMinor: z.coerce.number().int().min(0).optional() }).parse(req.query);
  const location = await db.location.findFirst({ where: { id: locationId }, select: { id: true, timezone: true } });
  if (!location) throw notFound("branch");
  const local = localParts(new Date(), location.timezone);
  const all = await db.promotion.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  const running = all.filter((p) => promotionProblem(p, location.id, local) === null);
  res.json({ data: running.map((p) => ({ id: p.id, name: p.name, description: p.description, valueType: p.valueType, value: p.valueType === "PERCENT" ? p.value / 100 : p.value, minSubtotalMinor: p.minSubtotalMinor, eligible: subtotalMinor === undefined || subtotalMinor >= p.minSubtotalMinor })) });
});

/** Is this coupon usable here and now, and what is it worth? (The order itself re-checks everything.) */
offers.post("/coupon-check", "orders.create", async (req, res) => {
  const input = couponCheckSchema.parse(req.body);
  const location = await db.location.findFirst({ where: { id: input.locationId }, select: { id: true, timezone: true } });
  if (!location) throw notFound("branch");
  const today = localParts(new Date(), location.timezone).date;
  const c = await db.coupon.findFirst({ where: { code: { equals: input.code.trim(), mode: "insensitive" } } });
  const bad = (m: string) => res.json({ data: { valid: false, message: m } });
  if (!c || !c.isActive) return bad("That coupon code is not valid");
  if (c.validFrom && today < c.validFrom.toISOString().slice(0, 10)) return bad("That coupon is not valid yet");
  if (c.validTo && today > c.validTo.toISOString().slice(0, 10)) return bad("That coupon has expired");
  if (c.maxUses !== null && c.usedCount >= c.maxUses) return bad("That coupon has been used up");
  if (input.subtotalMinor !== undefined && input.subtotalMinor < c.minSubtotalMinor) return bad("The order is below this coupon's minimum spend");
  res.json({ data: { valid: true, code: c.code, valueType: c.valueType, value: c.valueType === "PERCENT" ? c.value / 100 : c.value, description: c.description, forCustomer: c.customerId !== null } });
});

// ---------------------------------------------------------------- feedback
const feedback = securedRouter("/api/v1/feedback");

feedback.get("/", "feedback.view", async (req, res) => {
  const q = listQuery.extend({ locationId: idSchema.optional(), status: z.enum(["NEW", "REPLIED", "RESOLVED"]).optional(), rating: z.coerce.number().int().min(1).max(5).optional(), maxRating: z.coerce.number().int().min(1).max(5).optional() }).parse(req.query);
  const where = { ...(q.locationId && { locationId: q.locationId }), ...(q.status && { status: q.status }), ...(q.rating && { rating: q.rating }), ...(q.maxRating && { rating: { lte: q.maxRating } }) };
  const [rows, total] = await Promise.all([
    db.feedback.findMany({ where, orderBy: { createdAt: "desc" }, ...paging(q), include: { location: { select: { name: true } }, customer: { select: { name: true, phone: true } } } }),
    db.feedback.count({ where }),
  ]);
  res.json({ data: rows.map(({ location, customer, ...f }) => ({ ...f, locationName: location.name, customerName: customer?.name ?? null, customerPhone: customer?.phone ?? null })), meta: offsetMeta(q, total) });
});

feedback.get("/summary", "feedback.view", async (req, res) => {
  const q = z.object({ locationId: idSchema.optional() }).parse(req.query);
  const rows = await db.feedback.findMany({ where: q.locationId ? { locationId: q.locationId } : {}, select: { rating: true, status: true } });
  const dist = [1, 2, 3, 4, 5].map((r) => ({ rating: r, count: rows.filter((x) => x.rating === r).length }));
  res.json({ data: { total: rows.length, average: rows.length ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 10) / 10 : null, distribution: dist, newCount: rows.filter((r) => r.status === "NEW").length } });
});

feedback.post("/", "feedback.view", async (req, res) => {
  const input = feedbackInputSchema.parse(req.body);
  const created = await db.$transaction(async (tx) => {
    const location = await tx.location.findFirst({ where: { id: input.locationId } });
    if (!location) throw notFound("branch");
    if (input.orderId) await assertRef(tx.order, input.orderId, "order");
    if (input.customerId) await assertRef(tx.customer, input.customerId, "customer");
    const f = await tx.feedback.create({ data: { tenantId: ctx().tenantId, locationId: location.id, rating: input.rating, comment: input.comment ?? null, orderId: input.orderId ?? null, customerId: input.customerId ?? null, source: input.source ?? "STAFF", createdById: ctx().userId } });
    await recordAudit(tx, { action: "feedback.create", entityType: "Feedback", entityId: f.id, locationId: location.id, after: { rating: f.rating } });
    return f;
  });
  res.status(201).json({ data: created });
});

feedback.post("/:id/reply", "feedback.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = feedbackReplySchema.parse(req.body);
  const row = await db.$transaction(async (tx) => {
    const f = await tx.feedback.findFirst({ where: { id } });
    if (!f) throw notFound("feedback");
    const after = await tx.feedback.update({ where: { id }, data: { reply: input.reply, status: "REPLIED", repliedById: ctx().userId, repliedAt: new Date() } });
    await recordAudit(tx, { action: "feedback.reply", entityType: "Feedback", entityId: id, locationId: f.locationId });
    return after;
  });
  res.json({ data: row });
});

feedback.post("/:id/resolve", "feedback.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const row = await db.$transaction(async (tx) => {
    const f = await tx.feedback.findFirst({ where: { id } });
    if (!f) throw notFound("feedback");
    const after = await tx.feedback.update({ where: { id }, data: { status: "RESOLVED" } });
    await recordAudit(tx, { action: "feedback.resolve", entityType: "Feedback", entityId: id, locationId: f.locationId });
    return after;
  });
  res.json({ data: row });
});

export const customerProfileRouter = customerExtras.router;
export const loyaltyRouter = loyalty.router;
export const offersRouter = offers.router;
export const feedbackRouter = feedback.router;
