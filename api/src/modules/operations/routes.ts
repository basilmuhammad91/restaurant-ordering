import {
  assignRiderSchema, clockInSchema, clockOutSchema, deliveryFailSchema, deliveryZoneInputSchema, deliveryZoneUpdateSchema, employeeInputSchema, employeeUpdateSchema, idSchema,
  NOTIFICATION_TYPES, notificationPreferencesSchema, receiptTemplateSchema, riderInputSchema, riderUpdateSchema, rosterCopySchema, rosterShiftInputSchema, timeEntryAdjustSchema,
} from "@restoflux/contracts";
import { z } from "zod";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext } from "../../core/context/context.js";
import { db, type Tx } from "../../core/db/scoped.js";
import { AppError, fieldError, forbidden, notFound } from "../../core/http/errors.js";
import { offsetMeta, paging } from "../../core/http/pagination.js";
import { assertRef, boolQuery, defineResource } from "../../core/http/resource.js";
import { securedRouter } from "../../core/http/secured.js";
import { afterOrderCompleted } from "../customers/hooks.js";
import { consumeForOrder } from "../inventory/stock.js";

const ctx = () => requireContext();
const idParams = z.object({ id: idSchema });
const conflict = (message: string) => new AppError(409, "CONFLICT", message);
const asDate = (yyyyMmDd: string | null | undefined) => (yyyyMmDd ? new Date(`${yyyyMmDd}T00:00:00.000Z`) : null);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (yyyyMmDd: string, n: number) => isoDay(new Date(asDate(yyyyMmDd)!.getTime() + n * 86_400_000));
const dateRange = z.object({ from: z.iso.date(), to: z.iso.date() });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });

async function requireBranch(tx: Tx, id: string) {
  const l = await tx.location.findFirst({ where: { id } });
  if (!l || l.type !== "BRANCH") throw fieldError("locationId", "Choose a branch");
  return l;
}

// ================================================================= DELIVERY
export const deliveryZonesRouter = defineResource({
  mount: "/api/v1/delivery-zones", label: "delivery zone", entityType: "DeliveryZone", auditPrefix: "delivery.zones",
  model: (c) => c.deliveryZone as never,
  permissions: { read: ["delivery.view", "delivery.manage", "orders.create"], write: "delivery.manage" },
  createSchema: deliveryZoneInputSchema, updateSchema: deliveryZoneUpdateSchema,
  searchFields: ["name"], sortable: ["name", "feeMinor"], defaultSort: "name",
  filters: { locationId: idSchema.optional(), isActive: boolQuery.optional() },
  locationIdOf: (r) => r.locationId,
  prepare: async (input, { tx }) => { if (input.locationId) await requireBranch(tx, input.locationId); return input; },
});

export const ridersRouter = defineResource({
  mount: "/api/v1/riders", label: "rider", entityType: "Rider", auditPrefix: "riders",
  model: (c) => c.rider as never,
  permissions: { read: ["riders.manage", "delivery.view", "delivery.assign"], write: "riders.manage" },
  createSchema: riderInputSchema, updateSchema: riderUpdateSchema,
  searchFields: ["name", "phone", "vehicle"], sortable: ["name"], defaultSort: "name",
  filters: { isActive: boolQuery.optional() },
});

const deliveries = securedRouter("/api/v1/deliveries");

const orderNumber = (prefix: string | null, n: number | null) => `${prefix ? `${prefix}-` : ""}${String(n ?? 0).padStart(4, "0")}`;

/** Delivery orders and who is bringing them. Newest first; unassigned ones are the dispatcher's to-do list. */
deliveries.get("/", "delivery.view", async (req, res) => {
  const q = z.object({ locationId: idSchema.optional(), state: z.enum(["all", "unassigned", "active", "done"]).default("all"), from: z.iso.date().optional(), to: z.iso.date().optional() }).parse(req.query);
  const orders = await db.order.findMany({
    where: { orderType: "DELIVERY", status: { notIn: ["OPEN", "CANCELLED"] }, ...(q.locationId && { locationId: q.locationId }), ...((q.from || q.to) && { businessDate: { ...(q.from && { gte: asDate(q.from)! }), ...(q.to && { lte: asDate(q.to)! }) } }) },
    orderBy: { placedAt: "desc" }, take: 200,
    select: { id: true, displayNumber: true, status: true, paymentStatus: true, customerName: true, customerPhone: true, deliveryAddress: true, totalMinor: true, paidMinor: true, currencyCode: true, placedAt: true, locationId: true, location: { select: { name: true, orderPrefix: true } } },
  });
  const assignments = orders.length ? await db.deliveryAssignment.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, include: { rider: { select: { name: true, phone: true } } } }) : [];
  const byOrder = new Map(assignments.map((a) => [a.orderId, a]));
  const rows = orders.map(({ location, ...o }) => {
    const a = byOrder.get(o.id);
    return { ...o, orderNumber: orderNumber(location.orderPrefix, o.displayNumber), locationName: location.name, delivery: a ? { id: a.id, riderId: a.riderId, riderName: a.rider.name, riderPhone: a.rider.phone, status: a.status, assignedAt: a.assignedAt, pickedUpAt: a.pickedUpAt, deliveredAt: a.deliveredAt, failedReason: a.failedReason } : null };
  });
  const keep = (r: (typeof rows)[number]) =>
    q.state === "unassigned" ? !r.delivery || r.delivery.status === "FAILED" && r.status !== "COMPLETED"
    : q.state === "active" ? !!r.delivery && (r.delivery.status === "ASSIGNED" || r.delivery.status === "PICKED_UP")
    : q.state === "done" ? r.status === "COMPLETED" || r.delivery?.status === "DELIVERED" : true;
  res.json({ data: rows.filter(keep) });
});

async function loadDeliveryOrder(tx: Tx, orderId: string) {
  const order = await tx.order.findFirst({ where: { id: orderId } });
  if (!order || order.orderType !== "DELIVERY") throw notFound("delivery order");
  return order;
}
const statusEvent = (tx: Tx, orderId: string, from: string, to: string) => tx.orderStatusEvent.create({ data: { tenantId: ctx().tenantId, orderId, fromStatus: from as never, toStatus: to as never, byUserId: ctx().userId, note: "Delivery" } });

deliveries.post("/:id/assign", "delivery.assign", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { riderId } = assignRiderSchema.parse(req.body);
  const out = await db.$transaction(async (tx) => {
    const order = await loadDeliveryOrder(tx, id);
    if (["OPEN", "CANCELLED", "COMPLETED"].includes(order.status)) throw conflict("This order is not waiting for a rider");
    const rider = await assertRef(tx.rider, riderId, "rider", { isActive: true });
    const existing = await tx.deliveryAssignment.findFirst({ where: { orderId: id } });
    if (existing && (existing.status === "PICKED_UP" || existing.status === "DELIVERED")) throw conflict("The rider has already collected this order");
    const row = existing
      ? await tx.deliveryAssignment.update({ where: { id: existing.id }, data: { riderId, status: "ASSIGNED", failedReason: null, assignedById: ctx().userId, assignedAt: new Date() } })
      : await tx.deliveryAssignment.create({ data: { tenantId: ctx().tenantId, locationId: order.locationId, orderId: id, riderId, assignedById: ctx().userId } });
    await recordAudit(tx, { action: existing ? "delivery.reassign" : "delivery.assign", entityType: "Order", entityId: id, locationId: order.locationId, before: existing ? { riderId: existing.riderId } : null, after: { riderId, rider: rider!.name } });
    return row;
  });
  res.status(201).json({ data: out });
});

const advance = (path: string, from: ("ASSIGNED" | "PICKED_UP")[], to: "PICKED_UP" | "DELIVERED") =>
  deliveries.post(path, "delivery.assign", async (req, res) => {
    const { id } = idParams.parse(req.params);
    const out = await db.$transaction(async (tx) => {
      const order = await loadDeliveryOrder(tx, id);
      const a = await tx.deliveryAssignment.findFirst({ where: { orderId: id } });
      if (!a) throw conflict("Assign a rider first");
      if (!from.includes(a.status as never)) throw conflict(`This delivery is ${a.status.toLowerCase().replace("_", " ")}`);
      const now = new Date();
      await tx.deliveryAssignment.update({ where: { id: a.id }, data: to === "PICKED_UP" ? { status: "PICKED_UP", pickedUpAt: now } : { status: "DELIVERED", deliveredAt: now } });
      let orderStatus = order.status as string;
      if (to === "PICKED_UP" && ["CONFIRMED", "PREPARING", "READY"].includes(order.status)) {
        await tx.order.update({ where: { id }, data: { status: "OUT_FOR_DELIVERY" } });
        await statusEvent(tx, id, order.status, "OUT_FOR_DELIVERY");
        orderStatus = "OUT_FOR_DELIVERY";
      }
      if (to === "DELIVERED" && order.status === "OUT_FOR_DELIVERY" && order.paidMinor >= order.totalMinor) {
        // handed over and already paid: the order is finished, so stock, coupons and loyalty follow just as for any completed order
        await tx.order.update({ where: { id }, data: { status: "COMPLETED", completedAt: now } });
        await tx.orderLine.updateMany({ where: { orderId: id, status: { in: ["NEW", "PREPARING", "READY"] } }, data: { status: "SERVED" } });
        await statusEvent(tx, id, "OUT_FOR_DELIVERY", "COMPLETED");
        await consumeForOrder(tx, id);
        await afterOrderCompleted(tx, id);
        orderStatus = "COMPLETED";
      }
      await recordAudit(tx, { action: `delivery.${to.toLowerCase()}`, entityType: "Order", entityId: id, locationId: order.locationId, after: { orderStatus } });
      return { delivery: to, orderStatus, needsPayment: to === "DELIVERED" && order.paidMinor < order.totalMinor };
    });
    res.json({ data: out });
  });
advance("/:id/pickup", ["ASSIGNED"], "PICKED_UP");
advance("/:id/deliver", ["PICKED_UP"], "DELIVERED");

deliveries.post("/:id/fail", "delivery.assign", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { reason } = deliveryFailSchema.parse(req.body);
  await db.$transaction(async (tx) => {
    const order = await loadDeliveryOrder(tx, id);
    const a = await tx.deliveryAssignment.findFirst({ where: { orderId: id } });
    if (!a || (a.status !== "ASSIGNED" && a.status !== "PICKED_UP")) throw conflict("There is no delivery in progress to mark as failed");
    await tx.deliveryAssignment.update({ where: { id: a.id }, data: { status: "FAILED", failedReason: reason } });
    await recordAudit(tx, { action: "delivery.failed", entityType: "Order", entityId: id, locationId: order.locationId, reason });
  });
  res.json({ data: { status: "FAILED" } });
});

// ================================================================= STAFF
export const employeesRouter = defineResource({
  mount: "/api/v1/employees", label: "employee", entityType: "Employee", auditPrefix: "staff.employees",
  model: (c) => c.employee as never,
  permissions: { read: ["staff.view", "staff.manage", "roster.manage", "timeclock.manage"], write: "staff.manage" },
  createSchema: employeeInputSchema, updateSchema: employeeUpdateSchema,
  searchFields: ["name", "phone", "email", "position"], sortable: ["name", "position", "startDate"], defaultSort: "name",
  filters: { locationId: idSchema.optional(), isActive: boolQuery.optional() },
  locationIdOf: (r) => r.locationId ?? null,
  prepare: async (input, { tx }) => {
    if (input.locationId) await requireBranch(tx, input.locationId);
    if (input.userId) await assertRef(tx.user, input.userId, "user");
    return { ...input, ...(input.email === "" && { email: null }), ...(input.startDate !== undefined && { startDate: asDate(input.startDate) }) };
  },
});

// ---------------------------------------------------------------- roster
const roster = securedRouter("/api/v1/roster");
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** A shift as minutes from midnight; one that ends earlier than it starts runs past midnight. */
const span = (s: string, e: string): [number, number] => [minutes(s), minutes(e) <= minutes(s) ? minutes(e) + 1440 : minutes(e)];
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

roster.get("/", ["roster.manage", "staff.view"], async (req, res) => {
  const q = dateRange.extend({ locationId: idSchema.optional(), employeeId: idSchema.optional() }).parse(req.query);
  const rows = await db.rosterShift.findMany({
    where: { shiftDate: { gte: asDate(q.from)!, lte: asDate(q.to)! }, ...(q.locationId && { locationId: q.locationId }), ...(q.employeeId && { employeeId: q.employeeId }) },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }], take: 1000, include: { employee: { select: { name: true, position: true } }, location: { select: { name: true } } },
  });
  res.json({ data: rows.map(({ employee, location, shiftDate, ...r }) => ({ ...r, shiftDate: isoDay(shiftDate), employeeName: employee.name, employeePosition: employee.position, locationName: location.name })) });
});

async function assertNoClash(tx: Tx, employeeId: string, shiftDate: string, startTime: string, endTime: string) {
  const same = await tx.rosterShift.findMany({ where: { employeeId, shiftDate: asDate(shiftDate)! }, select: { startTime: true, endTime: true } });
  const mine = span(startTime, endTime);
  if (same.some((s) => overlaps(mine, span(s.startTime, s.endTime)))) throw conflict("That person is already rostered at that time");
}

roster.post("/", "roster.manage", async (req, res) => {
  const input = rosterShiftInputSchema.parse(req.body);
  const row = await db.$transaction(async (tx) => {
    await requireBranch(tx, input.locationId);
    await assertRef(tx.employee, input.employeeId, "employee", { isActive: true });
    await assertNoClash(tx, input.employeeId, input.shiftDate, input.startTime, input.endTime);
    const created = await tx.rosterShift.create({ data: { tenantId: ctx().tenantId, locationId: input.locationId, employeeId: input.employeeId, shiftDate: asDate(input.shiftDate)!, startTime: input.startTime, endTime: input.endTime, position: input.position ?? null, note: input.note ?? null, createdById: ctx().userId } });
    await recordAudit(tx, { action: "roster.create", entityType: "RosterShift", entityId: created.id, locationId: input.locationId, after: { employeeId: input.employeeId, date: input.shiftDate, start: input.startTime, end: input.endTime } });
    return created;
  });
  res.status(201).json({ data: { ...row, shiftDate: isoDay(row.shiftDate) } });
});

roster.delete("/:id", "roster.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  await db.$transaction(async (tx) => {
    const s = await tx.rosterShift.findFirst({ where: { id } });
    if (!s) throw notFound("shift");
    await tx.rosterShift.delete({ where: { id } });
    await recordAudit(tx, { action: "roster.delete", entityType: "RosterShift", entityId: id, locationId: s.locationId, before: { employeeId: s.employeeId, date: isoDay(s.shiftDate) } });
  });
  res.status(204).end();
});

/** Repeat one week's roster on another (skipping anything that would clash or belongs to someone who has left). */
roster.post("/copy-week", "roster.manage", async (req, res) => {
  const input = rosterCopySchema.parse(req.body);
  const out = await db.$transaction(async (tx) => {
    await requireBranch(tx, input.locationId);
    const delta = Math.round((asDate(input.toWeekStart)!.getTime() - asDate(input.fromWeekStart)!.getTime()) / 86_400_000);
    if (delta === 0) throw fieldError("toWeekStart", "Choose a different week to copy into");
    const source = await tx.rosterShift.findMany({ where: { locationId: input.locationId, shiftDate: { gte: asDate(input.fromWeekStart)!, lte: asDate(addDays(input.fromWeekStart, 6))! } }, include: { employee: { select: { isActive: true } } } });
    let copied = 0, skipped = 0;
    for (const s of source) {
      const date = addDays(isoDay(s.shiftDate), delta);
      try {
        if (!s.employee.isActive) throw new Error("inactive");
        await assertNoClash(tx, s.employeeId, date, s.startTime, s.endTime);
        await tx.rosterShift.create({ data: { tenantId: ctx().tenantId, locationId: s.locationId, employeeId: s.employeeId, shiftDate: asDate(date)!, startTime: s.startTime, endTime: s.endTime, position: s.position, note: s.note, createdById: ctx().userId } });
        copied++;
      } catch { skipped++; }
    }
    await recordAudit(tx, { action: "roster.copy", entityType: "Location", entityId: input.locationId, locationId: input.locationId, after: { from: input.fromWeekStart, to: input.toWeekStart, copied, skipped } });
    return { copied, skipped };
  });
  res.status(201).json({ data: out });
});

// ---------------------------------------------------------------- time clock
const clock = securedRouter("/api/v1/timeclock");
const hoursOf = (e: { clockInAt: Date; clockOutAt: Date | null; breakMinutes: number }, now = new Date()) =>
  Math.max(0, ((e.clockOutAt ?? now).getTime() - e.clockInAt.getTime()) / 3_600_000 - e.breakMinutes / 60);
const r2 = (n: number) => Math.round(n * 100) / 100;
const CLOCK_READ = ["timeclock.manage", "staff.view"] as const;

clock.get("/", [...CLOCK_READ], async (req, res) => {
  const q = dateRange.extend({ locationId: idSchema.optional(), employeeId: idSchema.optional(), open: boolQuery.optional() }).merge(pageQuery).parse(req.query);
  const where = { clockInAt: { gte: asDate(q.from)!, lt: asDate(addDays(q.to, 1))! }, ...(q.locationId && { locationId: q.locationId }), ...(q.employeeId && { employeeId: q.employeeId }), ...(q.open && { clockOutAt: null }) };
  const [rows, total] = await Promise.all([
    db.timeEntry.findMany({ where, orderBy: { clockInAt: "desc" }, ...paging(q), include: { employee: { select: { name: true, position: true } }, location: { select: { name: true } } } }),
    db.timeEntry.count({ where }),
  ]);
  res.json({ data: rows.map(({ employee, location, ...e }) => ({ ...e, employeeName: employee.name, position: employee.position, locationName: location.name, hours: r2(hoursOf(e)), isOpen: e.clockOutAt === null })), meta: offsetMeta(q, total) });
});

/** Who is clocked in right now. */
clock.get("/open", [...CLOCK_READ], async (_req, res) => {
  const rows = await db.timeEntry.findMany({ where: { clockOutAt: null }, orderBy: { clockInAt: "asc" }, include: { employee: { select: { name: true, position: true } }, location: { select: { name: true } } } });
  res.json({ data: rows.map(({ employee, location, ...e }) => ({ ...e, employeeName: employee.name, position: employee.position, locationName: location.name, hours: r2(hoursOf(e)) })) });
});

/** Hours and an estimated labour cost per person for a period. */
clock.get("/summary", [...CLOCK_READ], async (req, res) => {
  const q = dateRange.extend({ locationId: idSchema.optional() }).parse(req.query);
  const entries = await db.timeEntry.findMany({ where: { clockInAt: { gte: asDate(q.from)!, lt: asDate(addDays(q.to, 1))! }, ...(q.locationId && { locationId: q.locationId }) }, include: { employee: { select: { name: true, position: true, hourlyRateMinor: true } } } });
  const by = new Map<string, { employeeId: string; name: string; position: string | null; hourlyRateMinor: number | null; entries: number; hours: number }>();
  for (const e of entries) {
    const row = by.get(e.employeeId) ?? { employeeId: e.employeeId, name: e.employee.name, position: e.employee.position, hourlyRateMinor: e.employee.hourlyRateMinor, entries: 0, hours: 0 };
    row.entries++; row.hours += hoursOf(e); by.set(e.employeeId, row);
  }
  const data = [...by.values()].map((r) => ({ ...r, hours: r2(r.hours), laborCostMinor: r.hourlyRateMinor === null ? null : Math.round(r.hours * r.hourlyRateMinor) })).sort((a, b) => b.hours - a.hours);
  res.json({ data, meta: { totalHours: r2(data.reduce((s, r) => s + r.hours, 0)), laborCostMinor: data.reduce((s, r) => s + (r.laborCostMinor ?? 0), 0) } });
});

clock.post("/clock-in", "timeclock.manage", async (req, res) => {
  const input = clockInSchema.parse(req.body);
  const entry = await db.$transaction(async (tx) => {
    await assertRef(tx.employee, input.employeeId, "employee", { isActive: true });
    const location = await tx.location.findFirst({ where: { id: input.locationId } });
    if (!location) throw notFound("location");
    if (await tx.timeEntry.findFirst({ where: { employeeId: input.employeeId, clockOutAt: null } })) throw conflict("That person is already clocked in");
    return tx.timeEntry.create({ data: { tenantId: ctx().tenantId, locationId: input.locationId, employeeId: input.employeeId, clockInAt: new Date(), note: input.note ?? null, createdById: ctx().userId } });
  });
  res.status(201).json({ data: entry });
});

clock.post("/clock-out", "timeclock.manage", async (req, res) => {
  const input = clockOutSchema.parse(req.body);
  const out = await db.$transaction(async (tx) => {
    const open = await tx.timeEntry.findFirst({ where: { employeeId: input.employeeId, clockOutAt: null } });
    if (!open) throw conflict("That person is not clocked in");
    const row = await tx.timeEntry.update({ where: { id: open.id }, data: { clockOutAt: new Date(), breakMinutes: input.breakMinutes ?? open.breakMinutes } });
    return { ...row, hours: r2(hoursOf(row)) };
  });
  res.json({ data: out });
});

/** A manager corrects forgotten or wrong times. The reason is kept in the audit log with the old and new values. */
clock.patch("/:id", "timeclock.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = timeEntryAdjustSchema.parse(req.body);
  const out = await db.$transaction(async (tx) => {
    const e = await tx.timeEntry.findFirst({ where: { id } });
    if (!e) throw notFound("time entry");
    const clockInAt = input.clockInAt ? new Date(input.clockInAt) : e.clockInAt;
    const clockOutAt = input.clockOutAt === undefined ? e.clockOutAt : input.clockOutAt ? new Date(input.clockOutAt) : null;
    if (clockOutAt && clockOutAt < clockInAt) throw fieldError("clockOutAt", "Clock-out cannot be before clock-in");
    const after = await tx.timeEntry.update({ where: { id }, data: { clockInAt, clockOutAt, breakMinutes: input.breakMinutes ?? e.breakMinutes, adjustedById: ctx().userId } });
    await recordAudit(tx, { action: "timeclock.adjust", entityType: "TimeEntry", entityId: id, locationId: e.locationId, reason: input.reason, before: { clockInAt: e.clockInAt, clockOutAt: e.clockOutAt, breakMinutes: e.breakMinutes }, after: { clockInAt, clockOutAt, breakMinutes: after.breakMinutes } });
    return { ...after, hours: r2(hoursOf(after)) };
  });
  res.json({ data: out });
});

// ================================================================= SETTINGS
const settings = securedRouter("/api/v1/settings");
const RECEIPT_DEFAULTS = { headerText: null, footerText: "Thank you for dining with us!", showTaxBreakdown: true, showCustomer: true, showCashier: true };

/** Every till reads this to print receipts, so any signed-in person may read it; only settings managers change it. */
settings.get("/receipt", "authenticated", async (_req, res) => {
  const t = await db.receiptTemplate.findFirst({});
  res.json({ data: t ? { headerText: t.headerText, footerText: t.footerText, showTaxBreakdown: t.showTaxBreakdown, showCustomer: t.showCustomer, showCashier: t.showCashier } : RECEIPT_DEFAULTS });
});

settings.put("/receipt", "settings.manage", async (req, res) => {
  const input = receiptTemplateSchema.parse(req.body);
  const data = { headerText: input.headerText?.trim() || null, footerText: input.footerText?.trim() || null, showTaxBreakdown: input.showTaxBreakdown, showCustomer: input.showCustomer, showCashier: input.showCashier };
  const saved = await db.$transaction(async (tx) => {
    const before = await tx.receiptTemplate.findFirst({});
    const row = before ? await tx.receiptTemplate.update({ where: { id: before.id }, data }) : await tx.receiptTemplate.create({ data: { tenantId: ctx().tenantId, ...data } });
    await recordAudit(tx, { action: "settings.receipt", entityType: "ReceiptTemplate", entityId: row.id, before, after: row });
    return row;
  });
  res.json({ data: saved });
});

/** Each person chooses which alerts reach their own bell. */
settings.get("/notifications", "authenticated", async (req, res) => {
  const prefs = await db.notificationPreference.findMany({ where: { userId: req.principal!.userId } });
  const off = new Set(prefs.filter((p) => !p.inApp).map((p) => p.type));
  res.json({ data: NOTIFICATION_TYPES.map((t) => ({ ...t, inApp: !off.has(t.type) })) });
});

settings.put("/notifications", "authenticated", async (req, res) => {
  const input = notificationPreferencesSchema.parse(req.body);
  const known = new Set<string>(NOTIFICATION_TYPES.map((t) => t.type));
  const userId = req.principal!.userId;
  if (!userId) throw forbidden();
  await db.$transaction(async (tx) => {
    for (const p of input.preferences.filter((x) => known.has(x.type))) {
      const existing = await tx.notificationPreference.findFirst({ where: { userId, type: p.type } });
      if (existing) await tx.notificationPreference.update({ where: { id: existing.id }, data: { inApp: p.inApp } });
      else await tx.notificationPreference.create({ data: { tenantId: ctx().tenantId, userId, type: p.type, inApp: p.inApp } });
    }
  });
  res.json({ data: { saved: input.preferences.length } });
});

export const deliveriesRouter = deliveries.router;
export const rosterRouter = roster.router;
export const timeclockRouter = clock.router;
export const settingsRouter = settings.router;
