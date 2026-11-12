import { businessDateOf } from "@restoflux/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { runAsTenant } from "../../src/core/context/context.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { db } from "../../src/core/db/scoped.js";
import { createFixture, createStaff, loginOwner, loginStaff, type Fixture } from "../helpers/fixtures.js";
import { api } from "../helpers/http.js";
import { buildSalesWorld, PRICES, typicalOrder, type SalesWorld } from "../helpers/sales.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
const app = createApp();
let fx: Fixture;
let w: SalesWorld;
let owner: ReturnType<typeof api>;
// the trading day at the Karachi branch (its clock, not the server's)
const dayAt = (offsetDays: number) => businessDateOf(new Date(Date.now() + offsetDays * 86_400_000), "Asia/Karachi", "05:00");
const today = dayAt(0);
const tomorrow = dayAt(1);
const weekAgo = dayAt(-7);

beforeAll(async () => {
  fx = await createFixture();
  w = await buildSalesWorld(fx, app);
  owner = api(app, (await loginOwner(app, fx)).token);
}, 240_000);

afterAll(async () => {
  await fx.cleanup();
  await unscopedDb.$disconnect();
});

const order = async (as: ReturnType<typeof api>, over: object = {}) => {
  const res = await as.post("/orders", typicalOrder(w, { lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }], ...over }));
  expect(res.status, JSON.stringify(res.body?.error)).toBe(201);
  return res.body.data;
};
const FRIES_TOTAL = PRICES.fries + Math.floor((PRICES.fries * 13 * 2 + 100) / 200); // 33,900

describe("tills", () => {
  it("a branch has tills with unique names; only branches have them", async () => {
    const till = await owner.post("/cash-registers", { locationId: w.pkr.id, name: "Front till" });
    expect(till.status).toBe(201);
    expect((await owner.post("/cash-registers", { locationId: w.pkr.id, name: "front TILL" })).status).toBe(409);
    expect((await owner.get(`/cash-registers?locationId=${w.pkr.id}`)).body.data.map((r: any) => r.name)).toContain("Front till");
    expect((await w.as.cashier.post("/cash-registers", { locationId: w.pkr.id, name: "Mine" })).status).toBe(403); // cash.manage is a manager's permission
  });
});

describe("a shift from opening to closing", () => {
  let shift: any;
  let zId = "";

  it("opens with a float on the branch's till; a till can only have one open shift", async () => {
    const before = await w.as.cashier.get(`/shifts/current?locationId=${w.pkr.id}`);
    expect(before.body.data.shift).toBeNull();
    const open = await w.as.cashier.post("/shifts/open", { locationId: w.pkr.id, registerId: (await owner.get(`/cash-registers?locationId=${w.pkr.id}`)).body.data[0].id, openingFloatMinor: 500_000 });
    expect(open.status).toBe(201);
    shift = open.body.data;
    expect(shift).toMatchObject({ status: "OPEN", openingFloatMinor: 500_000, currencyCode: "PKR", openedByName: expect.any(String) });
    expect(shift.figures.expectedCashMinor).toBe(500_000);
    expect(shift.businessDate).toBe(today);
    const again = await owner.post("/shifts/open", { locationId: w.pkr.id, registerId: shift.registerId, openingFloatMinor: 1 });
    expect(again.status).toBe(409);
    expect((await w.as.kitchen.post("/shifts/open", { locationId: w.pkr.id, openingFloatMinor: 1 })).status).toBe(403);
  });

  it("cash sales, tips, refunds and cash movements all move the expected amount", async () => {
    const o1 = await order(w.as.cashier);
    await w.as.cashier.post(`/orders/${o1.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: 50_000, tipMinor: 2_000 }); // cash: +33,900 +2,000 tip (change 16,100 given back)
    const o2 = await order(w.as.cashier);
    await w.as.cashier.post(`/orders/${o2.id}/payments`, { paymentMethodId: w.methods.card, tenderedMinor: FRIES_TOTAL, reference: "S1" }); // card: not in the drawer

    const mv = (as: ReturnType<typeof api>, body: object) => as.post(`/shifts/${shift.id}/movements`, body);
    expect((await mv(w.as.cashier, { type: "CASH_IN", amountMinor: 10_000 })).status).toBe(403); // cashiers cannot move cash
    expect((await mv(w.as.manager, { type: "CASH_IN", amountMinor: 20_000, note: "extra change" })).status).toBe(201);
    expect((await mv(w.as.manager, { type: "PAID_OUT", amountMinor: 5_000 })).status).toBe(422); // what was it for?
    expect((await mv(w.as.manager, { type: "PAID_OUT", amountMinor: 5_000, reasonId: w.reasons.cashOut, note: "ice" })).status).toBe(201);
    expect((await mv(w.as.manager, { type: "CASH_OUT", amountMinor: 99_999_999, reasonId: w.reasons.cashOut })).status).toBe(422); // more than the drawer holds
    expect((await mv(w.as.manager, { type: "SAFE_DROP", amountMinor: 100_000 })).status).toBe(201);

    const refundBase = await order(w.as.cashier);
    await w.as.cashier.post(`/orders/${refundBase.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: FRIES_TOTAL });
    const refund = await w.as.manager.post(`/orders/${refundBase.id}/refund`, { amountMinor: 10_000, paymentMethodId: w.methods.cash, reasonId: w.reasons.refund });
    expect(refund.status).toBe(201);

    const cur = (await w.as.manager.get(`/shifts/current?locationId=${w.pkr.id}`)).body.data.shift;
    // float + cash sales (33,900 + 2,000 tip + 33,900) - cash refund 10,000 + cash in 20,000 - paid out 5,000 - safe drop 100,000
    const expected = 500_000 + (FRIES_TOTAL + 2_000) + FRIES_TOTAL - 10_000 + 20_000 - 5_000 - 100_000;
    expect(cur.figures).toMatchObject({ cashSalesMinor: FRIES_TOTAL * 2 + 2_000, cashRefundsMinor: 10_000, cashInMinor: 20_000, paidOutMinor: 5_000, safeDropsMinor: 100_000, expectedCashMinor: expected });
    expect(cur.movements).toHaveLength(3);
  });

  it("closing compares the count with what should be there, records the difference, warns a manager and stores a Z-report", async () => {
    const cur = (await owner.get(`/shifts/current?locationId=${w.pkr.id}`)).body.data.shift;
    const expected = cur.figures.expectedCashMinor as number;
    expect((await w.as.kitchen.post(`/shifts/${shift.id}/close`, { countedCashMinor: 1 })).status).toBe(403);
    const closed = await w.as.cashier.post(`/shifts/${shift.id}/close`, { countedCashMinor: expected - 4_000, notes: "short by a little" });
    expect(closed.status).toBe(200);
    expect(closed.body.data.shift).toMatchObject({ status: "CLOSED", expectedCashMinor: expected, countedCashMinor: expected - 4_000, varianceMinor: -4_000 });
    zId = closed.body.data.zReportId;

    expect((await w.as.cashier.post(`/shifts/${shift.id}/close`, { countedCashMinor: 1 })).status).toBe(409); // already closed
    expect((await w.as.cashier.post(`/shifts/${shift.id}/movements`, { type: "CASH_IN", amountMinor: 1 })).status).toBe(403);
    expect((await owner.post(`/shifts/${shift.id}/movements`, { type: "CASH_IN", amountMinor: 1 })).status).toBe(409);

    const alert = await runAsTenant(fx.tenantId, () => db.notification.findFirst({ where: { type: "CASH_SHORTAGE", entityId: shift.id } }));
    expect(alert).toMatchObject({ requiredPermission: "shifts.view", locationId: w.pkr.id });

    // cash needs a shift again
    const o = await order(owner);
    expect((await owner.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: FRIES_TOTAL })).status).toBe(409);
  });

  it("the Z-report is a snapshot that can never be edited or deleted", async () => {
    const z = (await owner.get(`/z-reports/${zId}`)).body.data;
    expect(z).toMatchObject({ scope: "SHIFT", cashShiftId: shift.id, businessDate: today });
    expect(z.data.cash).toMatchObject({ openingFloatMinor: 500_000, countedCashMinor: z.data.cash.expectedCashMinor - 4_000, varianceMinor: -4_000 });
    expect(z.data.sales.orders).toBeGreaterThanOrEqual(2);
    expect(z.data.sales.byPaymentMethod.map((p: any) => p.name).sort()).toEqual(["Card", "Cash"]);
    await expect(unscopedDb.zReport.update({ where: { id: zId }, data: { data: {} } })).rejects.toThrow();
    await expect(unscopedDb.zReport.delete({ where: { id: zId } })).rejects.toThrow();
    const list = await owner.get(`/z-reports?locationId=${w.pkr.id}`);
    expect(list.body.data.map((r: any) => r.id)).toContain(zId);
    expect((await w.as.cashier.get(`/z-reports/${zId}`)).status).toBe(403); // the cashier has no Z-report permission
    const history = await owner.get(`/shifts?locationId=${w.pkr.id}&status=CLOSED`);
    expect(history.body.data[0]).toMatchObject({ id: shift.id, varianceMinor: -4_000, zReportId: zId });
  });
});

describe("a blind close", () => {
  it("hides the expected cash until the shift is closed", async () => {
    const open = await owner.post("/shifts/open", { locationId: w.aed.id, openingFloatMinor: 100_000, isBlindClose: true });
    expect(open.status).toBe(201);
    expect(open.body.data.registerName).toBe("Main till"); // created on the spot: the branch had no till
    expect(open.body.data.figures).toMatchObject({ expectedCashMinor: null, cashSalesMinor: null });
    const cur = (await owner.get(`/shifts/current?locationId=${w.aed.id}`)).body.data.shift;
    expect(cur.figures.expectedCashMinor).toBeNull();
    const closed = await owner.post(`/shifts/${open.body.data.id}/close`, { countedCashMinor: 100_000 });
    expect(closed.body.data.shift).toMatchObject({ status: "CLOSED", expectedCashMinor: 100_000, varianceMinor: 0 }); // revealed now
    expect(await runAsTenant(fx.tenantId, () => db.notification.count({ where: { entityId: open.body.data.id } }))).toBe(0); // an exact count raises no alert
  });
});

describe("sales figures", () => {
  it("add up: net = total - tax - delivery, payments add up to collected, currencies never mix", async () => {
    // an open shift again so cash can be taken, then a few more orders (PKR and AED)
    const shift = (await owner.post("/shifts/open", { locationId: w.pkr.id, openingFloatMinor: 0 })).body.data;
    expect(shift.status).toBe("OPEN");
    const delivery = await order(owner, { orderType: "DELIVERY", deliveryAddress: { line1: "1 Test Rd" }, deliveryFeeMinor: 15_000 });
    await owner.post(`/orders/${delivery.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: delivery.totalMinor });
    const dxb = (await owner.post("/orders", { locationId: w.aed.id, orderType: "TAKEAWAY", channel: "POS", lines: [{ kind: "item", variantId: w.fries.regular, quantity: 3 }] })).body.data;
    await owner.post(`/orders/${dxb.id}/payments`, { paymentMethodId: w.methods.card, tenderedMinor: dxb.totalMinor, reference: "D1" });
    const cancelled = await order(owner);
    await owner.post(`/orders/${cancelled.id}/status`, { status: "CANCELLED", reasonId: w.reasons.void });

    const res = await owner.get(`/reports/sales-summary?from=${weekAgo}&to=${tomorrow}`);
    expect(res.status).toBe(200);
    const [aed, pkr] = res.body.data;
    expect([aed.currencyCode, pkr.currencyCode]).toEqual(["AED", "PKR"]);
    expect(aed).toMatchObject({ orders: 1, totalMinor: 3_000, grossSalesMinor: 3_000 });
    expect(aed.taxMinor).toBe(3_000 - Math.floor((3_000 * 10_000 * 2 + 10_500) / 21_000)); // 5% inside the price
    expect(aed.netSalesMinor).toBe(aed.totalMinor - aed.taxMinor);

    for (const s of [aed, pkr]) {
      expect(s.netSalesMinor).toBe(s.totalMinor - s.taxMinor - s.deliveryFeesMinor);
      expect(s.byPaymentMethod.reduce((a: number, p: any) => a + p.amountMinor, 0)).toBe(s.collectedMinor);
      expect(Object.values(s.byOrderType).reduce((a: number, v: any) => a + v.orders, 0)).toBe(s.orders);
      expect(s.averageOrderMinor).toBe(Math.round(s.totalMinor / s.orders));
    }
    expect(pkr.deliveryFeesMinor).toBe(15_000);
    expect(pkr.byOrderType.DELIVERY.orders).toBe(1);
    expect(pkr.cancelled.orders).toBe(1);
    expect(pkr.refunds.count).toBe(1);
    expect(pkr.byDay.at(-1).date).toBe(today);
  });

  it("filters by branch, and a branch-limited user only ever sees their own branch", async () => {
    const onlyDubai = await owner.get(`/reports/sales-summary?from=${weekAgo}&to=${tomorrow}&locationIds=${w.aed.id}`);
    expect(onlyDubai.body.data.map((s: any) => s.currencyCode)).toEqual(["AED"]);
    const manager = await w.as.manager.get(`/reports/sales-summary?from=${weekAgo}&to=${tomorrow}`);
    expect(manager.status).toBe(200);
    expect(manager.body.data.map((s: any) => s.currencyCode)).toEqual(["PKR"]); // the manager's branch is in PKR; Dubai is invisible to them
    expect((await w.as.cashier.get(`/reports/sales-summary?from=${weekAgo}&to=${tomorrow}`)).status).toBe(403);
  });

  it("the end-of-day report covers every shift and says if one is still open", async () => {
    const res = await owner.post("/z-reports/day", { locationId: w.pkr.id, businessDate: today });
    expect(res.status).toBe(201);
    const z = (await owner.get(`/z-reports/${res.body.data.id}`)).body.data;
    expect(z.scope).toBe("DAY");
    expect(z.data.shifts.length).toBeGreaterThanOrEqual(2);
    expect(z.data.openShifts).toBe(1);
    expect(z.data.note).toMatch(/still open/);
    expect(z.data.sales.orders).toBeGreaterThanOrEqual(4);
    expect((await owner.post("/z-reports/day", { locationId: w.pkr.id, businessDate: "not-a-date" })).status).toBe(422);
  });
});

describe("dashboard numbers", () => {
  it("money figures need the financial permission; everyone with dashboard access still sees counts", async () => {
    const counts = await createStaff(fx, { permissions: ["dashboard.view"], allLocations: true });
    const asCounts = api(app, (await loginStaff(app, counts)).token);
    const masked = await asCounts.get(`/dashboard/summary?from=${weekAgo}&to=${tomorrow}`);
    expect(masked.status).toBe(200);
    expect(masked.body.data.financial).toBe(false);
    const pkr = masked.body.data.currencies.find((c: any) => c.currencyCode === "PKR");
    expect(pkr.orders).toBeGreaterThan(0);
    expect(pkr).not.toHaveProperty("totalMinor");
    expect(pkr).not.toHaveProperty("netSalesMinor");
    expect(JSON.stringify(masked.body.data)).not.toMatch(/netSalesMinor|collectedMinor|byPaymentMethod/);

    const full = await owner.get(`/dashboard/summary?from=${weekAgo}&to=${tomorrow}`);
    expect(full.body.data.financial).toBe(true);
    expect(full.body.data.currencies.find((c: any) => c.currencyCode === "PKR").netSalesMinor).toBeGreaterThan(0);
    expect(typeof full.body.data.pipeline).toBe("object");
  });
});

describe("isolation", () => {
  it("another organization sees none of these shifts, reports or numbers", async () => {
    const other = await createFixture();
    try {
      const asOther = api(app, (await loginOwner(app, other)).token);
      expect((await asOther.get(`/shifts/current?locationId=${w.pkr.id}`)).status).toBe(404);
      expect((await asOther.get("/shifts")).body.data).toEqual([]);
      expect((await asOther.get("/z-reports")).body.data).toEqual([]);
      expect((await asOther.post("/z-reports/day", { locationId: w.pkr.id, businessDate: today })).status).toBe(404);
      expect((await asOther.get(`/reports/sales-summary?from=${weekAgo}&to=${tomorrow}`)).body.data).toEqual([]);
      expect((await asOther.post("/shifts/open", { locationId: w.pkr.id, openingFloatMinor: 1 })).status).toBe(422);
    } finally {
      await other.cleanup();
    }
  });
});
