import {
  businessDateOf, cashMovementInputSchema, cashVariance, idSchema, registerInputSchema, registerUpdateSchema, salesSummaryQuerySchema, shiftCloseSchema,
  shiftOpenSchema, zReportDaySchema, zReportListQuerySchema,
} from "@restoflux/contracts";
import { z } from "zod";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext } from "../../core/context/context.js";
import { db, type Tx } from "../../core/db/scoped.js";
import { fieldError, notFound } from "../../core/http/errors.js";
import { offsetMeta, paging } from "../../core/http/pagination.js";
import { assertRef, defineResource } from "../../core/http/resource.js";
import { securedRouter } from "../../core/http/secured.js";
import { notify } from "../../core/notifications/notify.js";
import { buildSalesSummary, shiftFigures } from "./sales.js";
import { asDate, conflictError } from "./shared.js";

// SHIFTS AND CASH. A cashier opens a shift with a float, takes cash and card, records cash in/out and safe
// drops, then closes by counting the drawer. The system compares the count with what SHOULD be there
// (float + cash sales - cash refunds + cash in - cash out - paid-outs - safe drops) and records the
// variance. Closing writes an immutable Z-report. A blind close hides the expected amount from the counter.

const idParams = z.object({ id: idSchema });
const tenantId = () => requireContext().tenantId;

// ---------------------------------------------------------------- registers (tills)
export const registersRouter = defineResource({
  mount: "/api/v1/cash-registers",
  label: "register",
  entityType: "CashRegister",
  auditPrefix: "cash-registers",
  model: (c) => c.cashRegister as never,
  permissions: { read: "shifts.view", write: "cash.manage" },
  createSchema: registerInputSchema,
  updateSchema: registerUpdateSchema,
  searchFields: ["name"],
  sortable: ["name", "createdAt"],
  defaultSort: "name",
  filters: { locationId: idSchema.optional() },
  locationIdOf: (row) => row.locationId as string,
  prepare: async (input, { tx }) => {
    if (input.locationId) {
      const loc = await assertRef(tx.location as never, input.locationId, "location");
      if (loc && loc.type !== "BRANCH") throw fieldError("locationId", "Tills belong to branches");
    }
    return input;
  },
});

// ---------------------------------------------------------------- shifts
const shifts = securedRouter("/api/v1/shifts");

const shiftSelect = {
  id: true, locationId: true, registerId: true, businessDate: true, status: true, currencyCode: true, openedById: true, openedAt: true, openingFloatMinor: true, closedById: true,
  closedAt: true, expectedCashMinor: true, countedCashMinor: true, varianceMinor: true, isBlindClose: true, notes: true,
} as const;

async function describeShift(tx: Tx, s: { id: string; openingFloatMinor: number; status: string; isBlindClose: boolean; openedById: string; closedById: string | null; locationId: string; registerId: string } & Record<string, unknown>) {
  const [figures, movements, users, register, location] = await Promise.all([
    shiftFigures(tx, s),
    tx.cashMovement.findMany({ where: { shiftId: s.id }, orderBy: { occurredAt: "asc" } }),
    tx.user.findMany({ where: { id: { in: [s.openedById, ...(s.closedById ? [s.closedById] : [])] } }, select: { id: true, name: true } }),
    tx.cashRegister.findFirst({ where: { id: s.registerId }, select: { name: true } }),
    tx.location.findFirst({ where: { id: s.locationId }, select: { name: true } }),
  ]);
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  // while a blind shift is still open, the person counting must not see what is expected
  const hidden = s.isBlindClose && s.status === "OPEN";
  return {
    ...s,
    businessDate: (s.businessDate as Date).toISOString().slice(0, 10),
    registerName: register?.name ?? null, locationName: location?.name ?? null, openedByName: name(s.openedById), closedByName: name(s.closedById),
    figures: hidden ? { ...figures, cashSalesMinor: null, cashRefundsMinor: null, expectedCashMinor: null } : figures,
    movements,
  };
}

shifts.get("/current", "shifts.view", async (req, res) => {
  const { locationId } = z.object({ locationId: idSchema }).parse(req.query);
  const location = await db.location.findFirst({ where: { id: locationId }, select: { id: true } });
  if (!location) throw notFound("location");
  const shift = await db.cashShift.findFirst({ where: { locationId, status: "OPEN" }, orderBy: { openedAt: "desc" }, select: shiftSelect });
  const registers = await db.cashRegister.findMany({ where: { locationId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  res.json({ data: { shift: shift ? await describeShift(db, shift) : null, registers } });
});

shifts.post("/open", "shifts.open", async (req, res) => {
  const input = shiftOpenSchema.parse(req.body);
  const actor = req.principal!;
  const shift = await db.$transaction(async (tx) => {
    const location = await tx.location.findFirst({ where: { id: input.locationId } });
    if (!location || location.type !== "BRANCH") throw fieldError("locationId", "Shifts are opened at a branch");

    let registerId = input.registerId;
    if (registerId) {
      const reg = await tx.cashRegister.findFirst({ where: { id: registerId, locationId: location.id, isActive: true } });
      if (!reg) throw fieldError("registerId", "That till does not exist at this branch");
    } else {
      const first = await tx.cashRegister.findFirst({ where: { locationId: location.id, isActive: true }, orderBy: { createdAt: "asc" } });
      registerId = first?.id ?? (await tx.cashRegister.create({ data: { tenantId: tenantId(), locationId: location.id, name: "Main till" } })).id;
    }
    if (await tx.cashShift.findFirst({ where: { registerId, status: "OPEN" } })) throw conflictError("This till already has an open shift");

    const businessDate = businessDateOf(new Date(), location.timezone, location.businessDayStartTime ?? "05:00");
    const created = await tx.cashShift.create({
      data: { tenantId: tenantId(), locationId: location.id, registerId, businessDate: asDate(businessDate), currencyCode: location.currencyCode, openedById: actor.userId, openingFloatMinor: input.openingFloatMinor, isBlindClose: input.isBlindClose ?? false },
      select: shiftSelect,
    });
    await recordAudit(tx, { action: "shifts.open", entityType: "CashShift", entityId: created.id, locationId: location.id, after: { openingFloatMinor: input.openingFloatMinor, registerId, businessDate } });
    return describeShift(tx, created);
  });
  res.status(201).json({ data: shift });
});

shifts.post("/:id/movements", "cash.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = cashMovementInputSchema.parse(req.body);
  const actor = req.principal!;
  const shift = await db.$transaction(async (tx) => {
    const s = await tx.cashShift.findFirst({ where: { id } });
    if (!s) throw notFound("shift");
    if (s.status !== "OPEN") throw conflictError("This shift is closed");
    if ((input.type === "CASH_OUT" || input.type === "PAID_OUT") && !input.reasonId) throw fieldError("reasonId", "Say what the money was for");
    if (input.reasonId && !(await tx.reasonCode.findFirst({ where: { id: input.reasonId, type: "CASH_OUT" } }))) throw fieldError("reasonId", "Choose one of the listed reasons");

    // cash can never leave a drawer that does not hold it
    const figures = await shiftFigures(tx, s);
    if (input.type !== "CASH_IN" && input.amountMinor > figures.expectedCashMinor) throw fieldError("amountMinor", "There is not that much cash in the drawer");

    await tx.cashMovement.create({ data: { tenantId: tenantId(), locationId: s.locationId, shiftId: id, type: input.type, amountMinor: input.amountMinor, reasonId: input.reasonId ?? null, note: input.note ?? null, createdById: actor.userId } });
    await recordAudit(tx, { action: `cash.${input.type.toLowerCase()}`, entityType: "CashShift", entityId: id, locationId: s.locationId, after: { amountMinor: input.amountMinor, note: input.note ?? null } });
    return describeShift(tx, s);
  });
  res.status(201).json({ data: shift });
});

shifts.post("/:id/close", "shifts.close", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = shiftCloseSchema.parse(req.body);
  const actor = req.principal!;

  const result = await db.$transaction(async (tx) => {
    const s = await tx.cashShift.findFirst({ where: { id } });
    if (!s) throw notFound("shift");
    if (s.status !== "OPEN") throw conflictError("This shift is already closed");
    const location = await tx.location.findFirstOrThrow({ where: { id: s.locationId } });

    const figures = await shiftFigures(tx, s);
    const variance = cashVariance(input.countedCashMinor, figures.expectedCashMinor);
    const closedAt = new Date();
    await tx.cashShift.update({ where: { id }, data: { status: "CLOSED", closedAt, closedById: actor.userId, expectedCashMinor: figures.expectedCashMinor, countedCashMinor: input.countedCashMinor, varianceMinor: variance, notes: input.notes ?? null } });

    const date = s.businessDate.toISOString().slice(0, 10);
    const sales = await buildSalesSummary({ locationIds: [s.locationId], from: date, to: date, shiftId: id }, tx);
    const closed = await tx.cashShift.findFirstOrThrow({ where: { id }, select: shiftSelect });
    const described = await describeShift(tx, closed);
    const z = await tx.zReport.create({
      data: {
        tenantId: tenantId(), locationId: s.locationId, businessDate: s.businessDate, scope: "SHIFT", cashShiftId: id, generatedById: actor.userId,
        data: JSON.parse(JSON.stringify({ location: { name: location.name, currencyCode: location.currencyCode }, shift: described, sales: sales[0] ?? null, cash: { ...figures, countedCashMinor: input.countedCashMinor, varianceMinor: variance } })),
      },
    });
    await recordAudit(tx, { action: "shifts.close", entityType: "CashShift", entityId: id, locationId: s.locationId, after: { expectedCashMinor: figures.expectedCashMinor, countedCashMinor: input.countedCashMinor, varianceMinor: variance } });

    // a shortage or overage is something a manager should hear about the same day
    if (variance !== 0) {
      await notify(tx, {
        type: variance < 0 ? "CASH_SHORTAGE" : "CASH_OVERAGE", severity: Math.abs(variance) >= Math.max(figures.expectedCashMinor * 0.02, 10_000) ? "CRITICAL" : "WARN",
        title: `${variance < 0 ? "Cash short" : "Cash over"} at ${location.name}`, body: `Counted ${input.countedCashMinor / 100} against ${figures.expectedCashMinor / 100} expected (${location.currencyCode}).`,
        requiredPermission: "shifts.view", locationId: s.locationId, entityType: "CashShift", entityId: id, dedupeKey: `cash-variance:${id}`,
      });
    }
    return { shift: described, zReportId: z.id };
  });
  res.json({ data: result });
});

shifts.get("/", "shifts.view", async (req, res) => {
  const q = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), locationId: idSchema.optional(), status: z.enum(["OPEN", "CLOSED"]).optional() }).parse(req.query);
  const where = { ...(q.locationId && { locationId: q.locationId }), ...(q.status && { status: q.status }) };
  const [rows, total] = await Promise.all([db.cashShift.findMany({ where, select: shiftSelect, orderBy: { openedAt: "desc" }, ...paging(q) }), db.cashShift.count({ where })]);
  const [locations, users, zs, registers] = await Promise.all([
    db.location.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.locationId))] } }, select: { id: true, name: true } }),
    db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.openedById, ...(r.closedById ? [r.closedById] : [])]))] } }, select: { id: true, name: true } }),
    db.zReport.findMany({ where: { cashShiftId: { in: rows.map((r) => r.id) } }, select: { id: true, cashShiftId: true } }),
    db.cashRegister.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.registerId))] } }, select: { id: true, name: true } }),
  ]);
  res.json({
    data: rows.map((r) => ({
      ...r, businessDate: r.businessDate.toISOString().slice(0, 10), locationName: locations.find((l) => l.id === r.locationId)?.name ?? null, registerName: registers.find((g) => g.id === r.registerId)?.name ?? null,
      openedByName: users.find((u) => u.id === r.openedById)?.name ?? null, closedByName: users.find((u) => u.id === r.closedById)?.name ?? null, zReportId: zs.find((z) => z.cashShiftId === r.id)?.id ?? null,
    })),
    meta: offsetMeta(q, total),
  });
});

shifts.get("/:id", "shifts.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const s = await db.cashShift.findFirst({ where: { id }, select: shiftSelect });
  if (!s) throw notFound("shift");
  res.json({ data: await describeShift(db, s) });
});

export const shiftsRouter = shifts.router;

// ---------------------------------------------------------------- Z-reports
const zreports = securedRouter("/api/v1/z-reports");

zreports.get("/", "zreport.view", async (req, res) => {
  const q = zReportListQuerySchema.parse(req.query);
  const rows = await db.zReport.findMany({
    where: { ...(q.locationId && { locationId: q.locationId }), ...((q.from || q.to) && { businessDate: { ...(q.from && { gte: asDate(q.from) }), ...(q.to && { lte: asDate(q.to) }) } }) },
    orderBy: { generatedAt: "desc" }, take: 100,
    select: { id: true, locationId: true, businessDate: true, scope: true, cashShiftId: true, generatedAt: true },
  });
  const locations = await db.location.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.locationId))] } }, select: { id: true, name: true } });
  res.json({ data: rows.map((r) => ({ ...r, businessDate: r.businessDate.toISOString().slice(0, 10), locationName: locations.find((l) => l.id === r.locationId)?.name ?? null })) });
});

zreports.get("/:id", "zreport.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const row = await db.zReport.findFirst({ where: { id } });
  if (!row) throw notFound("Z-report");
  res.json({ data: { ...row, businessDate: row.businessDate.toISOString().slice(0, 10) } });
});

/** End-of-day report for a whole branch and trading day: all shifts, all payments, all tax. Each call stores a new snapshot. */
zreports.post("/day", "zreport.view", async (req, res) => {
  const input = zReportDaySchema.parse(req.body);
  const actor = req.principal!;
  const row = await db.$transaction(async (tx) => {
    const location = await tx.location.findFirst({ where: { id: input.locationId } });
    if (!location || location.type !== "BRANCH") throw notFound("branch");
    const [sales, dayShifts] = await Promise.all([
      buildSalesSummary({ locationIds: [location.id], from: input.businessDate, to: input.businessDate }, tx),
      tx.cashShift.findMany({ where: { locationId: location.id, businessDate: asDate(input.businessDate) }, select: shiftSelect, orderBy: { openedAt: "asc" } }),
    ]);
    const described = await Promise.all(dayShifts.map((s) => describeShift(tx, s)));
    const open = described.filter((s) => s.status === "OPEN").length;
    const z = await tx.zReport.create({
      data: {
        tenantId: tenantId(), locationId: location.id, businessDate: asDate(input.businessDate), scope: "DAY", generatedById: actor.userId,
        data: JSON.parse(JSON.stringify({ location: { name: location.name, currencyCode: location.currencyCode, orderPrefix: location.orderPrefix }, sales: sales[0] ?? null, shifts: described, openShifts: open, note: open ? `${open} shift(s) were still open when this report was taken.` : null })),
      },
    });
    await recordAudit(tx, { action: "zreport.day", entityType: "ZReport", entityId: z.id, locationId: location.id, after: { businessDate: input.businessDate, openShifts: open } });
    return z;
  });
  res.status(201).json({ data: { ...row, businessDate: row.businessDate.toISOString().slice(0, 10) } });
});

export const zReportsRouter = zreports.router;

// ---------------------------------------------------------------- sales summary and dashboard
const reports = securedRouter("/api/v1/reports");

reports.get("/sales-summary", "reports.sales.view", async (req, res) => {
  const q = salesSummaryQuerySchema.parse(req.query);
  res.json({ data: await buildSalesSummary(q) });
});

const dash = securedRouter("/api/v1/dashboard");

/** The dashboard's numbers. Without the financial permission only counts are returned. */
dash.get("/summary", "dashboard.view", async (req, res) => {
  const q = salesSummaryQuerySchema.parse(req.query);
  const principal = req.principal!;
  const summaries = await buildSalesSummary(q);
  const financial = principal.permissions.has("dashboard.financial.view");
  const working = await db.order.findMany({ where: { status: { in: ["PENDING", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] }, ...(q.locationIds?.length && { locationId: { in: q.locationIds } }) }, select: { status: true } });
  const pipeline: Record<string, number> = {};
  for (const o of working) pipeline[o.status] = (pipeline[o.status] ?? 0) + 1;
  res.json({
    data: {
      financial,
      pipeline,
      currencies: financial
        ? summaries
        : summaries.map((s) => ({ currencyCode: s.currencyCode, orders: s.orders, byOrderType: Object.fromEntries(Object.entries(s.byOrderType).map(([k, v]) => [k, { orders: v.orders, totalMinor: 0 }])), byStatus: s.byStatus })),
    },
  });
});

export const reportsRouter = reports.router;
export const dashboardRouter = dash.router;
