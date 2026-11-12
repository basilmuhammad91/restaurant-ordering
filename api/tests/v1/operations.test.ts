import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { createFixture, loginOwner, type Fixture } from "../helpers/fixtures.js";
import { api, auditFor } from "../helpers/http.js";
import { buildSalesWorld, typicalOrder, type SalesWorld } from "../helpers/sales.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
const app = createApp();
let fx: Fixture;
let w: SalesWorld;
let owner: ReturnType<typeof api>;
let rider: any, maya: any, sam: any;
const ADDRESS = { line1: "12 Garden Road" };

beforeAll(async () => {
  fx = await createFixture();
  w = await buildSalesWorld(fx, app);
  owner = api(app, (await loginOwner(app, fx)).token);
}, 240_000);
afterAll(async () => {
  await fx.cleanup();
  await unscopedDb.$disconnect();
});

const must = async (p: Promise<any>, status = 201) => { const r = await p; expect(r.status, JSON.stringify(r.body?.error)).toBe(status); return r.body.data; };
const deliveryOrder = async (paid = true) => {
  const o = await must(w.as.cashier.post("/orders", typicalOrder(w, { orderType: "DELIVERY", deliveryAddress: ADDRESS, customerName: "Hira", customerPhone: "03005550000", lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] })));
  if (paid) await must(owner.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.card, tenderedMinor: o.totalMinor, reference: "D1" }));
  return o;
};
const listed = async (state: string) => ((await owner.get(`/deliveries?state=${state}&locationId=${w.pkr.id}`)).body.data as any[]);

describe("delivery zones and riders", () => {
  it("zones carry a fee per branch, readable at the till but changed only by delivery managers", async () => {
    await must(owner.post("/delivery-zones", { locationId: w.pkr.id, name: "Clifton", feeMinor: 15_000, estimatedMinutes: 40 }));
    const seen = (await w.as.cashier.get(`/delivery-zones?locationId=${w.pkr.id}`)).body.data as any[];
    expect(seen.map((z) => [z.name, z.feeMinor])).toEqual([["Clifton", 15_000]]);
    expect((await w.as.cashier.post("/delivery-zones", { locationId: w.pkr.id, name: "Nope" })).status).toBe(403);
    expect((await owner.post("/delivery-zones", { locationId: "00000000-0000-4000-8000-000000000000", name: "Ghost" })).status).toBe(422);
  });

  it("riders are managed by the people who may", async () => {
    rider = await must(owner.post("/riders", { name: "Bilal", phone: "03001112222", vehicle: "Bike" }));
    expect((await w.as.cashier.post("/riders", { name: "Nope" })).status).toBe(403);
    expect(((await owner.get("/riders")).body.data as any[]).map((r) => r.name)).toEqual(["Bilal"]);
  });
});

describe("a delivery from kitchen to door", () => {
  let order: any;
  it("waits for a rider, is assigned, collected and delivered; a paid order then completes by itself", async () => {
    order = await deliveryOrder();
    expect((await listed("unassigned")).map((d) => d.id)).toContain(order.id);
    expect((await owner.post(`/deliveries/${order.id}/pickup`, {})).status).toBe(409); // nobody assigned yet
    await must(owner.post(`/deliveries/${order.id}/assign`, { riderId: rider.id }));
    const active = (await listed("active")).find((d) => d.id === order.id);
    expect(active.delivery).toMatchObject({ riderName: "Bilal", status: "ASSIGNED" });
    expect((await listed("unassigned")).map((d) => d.id)).not.toContain(order.id);

    const picked = await must(owner.post(`/deliveries/${order.id}/pickup`, {}), 200);
    expect(picked.orderStatus).toBe("OUT_FOR_DELIVERY");
    expect((await owner.post(`/deliveries/${order.id}/assign`, { riderId: rider.id })).status).toBe(409); // already on the road
    const done = await must(owner.post(`/deliveries/${order.id}/deliver`, {}), 200);
    expect(done).toMatchObject({ orderStatus: "COMPLETED", needsPayment: false });
    expect((await owner.get(`/orders/${order.id}`)).body.data.status).toBe("COMPLETED");
    expect((await listed("done")).map((d) => d.id)).toContain(order.id);
    expect((await w.as.kitchen.post(`/deliveries/${order.id}/assign`, { riderId: rider.id })).status).toBe(403);
  });

  it("an unpaid order stays open after delivery so the cash can be collected, and a failed delivery can be sent out again", async () => {
    const unpaid = await deliveryOrder(false);
    await must(owner.post(`/deliveries/${unpaid.id}/assign`, { riderId: rider.id }));
    await must(owner.post(`/deliveries/${unpaid.id}/pickup`, {}), 200);
    const delivered = await must(owner.post(`/deliveries/${unpaid.id}/deliver`, {}), 200);
    expect(delivered).toMatchObject({ orderStatus: "OUT_FOR_DELIVERY", needsPayment: true });

    const second = await deliveryOrder();
    await must(owner.post(`/deliveries/${second.id}/assign`, { riderId: rider.id }));
    expect((await owner.post(`/deliveries/${second.id}/fail`, {})).status).toBe(422); // what went wrong?
    await must(owner.post(`/deliveries/${second.id}/fail`, { reason: "Customer not answering" }), 200);
    expect((await listed("unassigned")).map((d) => d.id)).toContain(second.id);
    await must(owner.post(`/deliveries/${second.id}/assign`, { riderId: rider.id })); // try again
  });
});

describe("staff and the roster", () => {
  const monday = "2026-11-02";
  it("employees are managed by staff managers", async () => {
    maya = await must(owner.post("/employees", { name: "Maya", position: "Waiter", locationId: w.pkr.id, hourlyRateMinor: 50_000, email: "" }));
    sam = await must(owner.post("/employees", { name: "Sam", position: "Cook" }));
    expect((await w.as.cashier.post("/employees", { name: "Nope" })).status).toBe(403);
    expect(((await owner.get("/employees")).body.data as any[]).map((e) => e.name)).toEqual(["Maya", "Sam"]);
  });

  it("shifts cannot overlap for one person, and a night shift may run past midnight", async () => {
    const shift = (body: object) => owner.post("/roster", { employeeId: maya.id, locationId: w.pkr.id, shiftDate: monday, ...body });
    await must(shift({ startTime: "10:00", endTime: "18:00", position: "Floor" }));
    expect((await shift({ startTime: "17:00", endTime: "20:00" })).status).toBe(409);
    await must(shift({ startTime: "18:00", endTime: "23:00" })); // back to back is fine
    expect((await shift({ startTime: "22:00", endTime: "02:00" })).status).toBe(409); // overlaps 18-23
    await must(owner.post("/roster", { employeeId: sam.id, locationId: w.pkr.id, shiftDate: monday, startTime: "22:00", endTime: "02:00" })); // different person, past midnight
    expect((await owner.post("/roster", { employeeId: sam.id, locationId: w.pkr.id, shiftDate: monday, startTime: "09:00", endTime: "09:00" })).status).toBe(422);
    const week = (await owner.get(`/roster?from=${monday}&to=2026-11-08&locationId=${w.pkr.id}`)).body.data as any[];
    expect(week.map((s) => [s.employeeName, s.startTime, s.endTime])).toEqual([["Maya", "10:00", "18:00"], ["Maya", "18:00", "23:00"], ["Sam", "22:00", "02:00"]]);
  });

  it("a week can be copied to the next, skipping anything that would clash", async () => {
    const copy = await must(owner.post("/roster/copy-week", { locationId: w.pkr.id, fromWeekStart: monday, toWeekStart: "2026-11-09" }));
    expect(copy).toEqual({ copied: 3, skipped: 0 });
    expect((await must(owner.post("/roster/copy-week", { locationId: w.pkr.id, fromWeekStart: monday, toWeekStart: "2026-11-09" }))).skipped).toBe(3);
    expect((await owner.post("/roster/copy-week", { locationId: w.pkr.id, fromWeekStart: monday, toWeekStart: monday })).status).toBe(422);
    const next = (await owner.get(`/roster?from=2026-11-09&to=2026-11-15`)).body.data as any[];
    expect(next).toHaveLength(3);
    await must(owner.del(`/roster/${next[0].id}`), 204);
  });
});

describe("the time clock", () => {
  let entry: any;
  it("clocks people in and out, one open entry each", async () => {
    entry = await must(owner.post("/timeclock/clock-in", { employeeId: maya.id, locationId: w.pkr.id }));
    expect((await owner.post("/timeclock/clock-in", { employeeId: maya.id, locationId: w.pkr.id })).status).toBe(409);
    expect(((await owner.get("/timeclock/open")).body.data as any[]).map((e) => e.employeeName)).toEqual(["Maya"]);
    expect((await owner.post("/timeclock/clock-out", { employeeId: sam.id })).status).toBe(409); // Sam never clocked in
    const out = await must(owner.post("/timeclock/clock-out", { employeeId: maya.id, breakMinutes: 30 }), 200);
    expect(out.clockOutAt).toBeTruthy();
    expect((await w.as.cashier.post("/timeclock/clock-in", { employeeId: sam.id, locationId: w.pkr.id })).status).toBe(403);
  });

  it("a manager corrects times with a reason, and hours and labour cost follow", async () => {
    const fix = { clockInAt: "2026-11-01T08:00:00.000Z", clockOutAt: "2026-11-01T16:30:00.000Z", breakMinutes: 30 };
    expect((await owner.patch(`/timeclock/${entry.id}`, fix)).status).toBe(422); // why?
    expect((await owner.patch(`/timeclock/${entry.id}`, { ...fix, clockOutAt: "2026-11-01T07:00:00.000Z", reason: "typo" })).status).toBe(422); // out before in
    const adjusted = await must(owner.patch(`/timeclock/${entry.id}`, { ...fix, reason: "Forgot to clock in" }), 200);
    expect(adjusted.hours).toBe(8); // 8.5 hours less a 30 minute break
    const summary = (await owner.get("/timeclock/summary?from=2026-11-01&to=2026-11-01")).body;
    expect(summary.data).toEqual([expect.objectContaining({ name: "Maya", hours: 8, entries: 1, laborCostMinor: 400_000 })]);
    expect(summary.meta).toMatchObject({ totalHours: 8, laborCostMinor: 400_000 });
    const log = await auditFor(fx.tenantId, "TimeEntry", entry.id);
    expect(log.some((l) => l.action === "timeclock.adjust" && l.reason === "Forgot to clock in")).toBe(true);
  });
});

describe("settings", () => {
  it("the receipt template is readable at every till and changed only by settings managers", async () => {
    expect((await w.as.cashier.get("/settings/receipt")).body.data).toMatchObject({ showTaxBreakdown: true, footerText: expect.any(String) });
    expect((await w.as.cashier.put("/settings/receipt", { showTaxBreakdown: false, showCustomer: true, showCashier: true })).status).toBe(403);
    await must(owner.put("/settings/receipt", { headerText: "Saffron Table, Gulberg", footerText: "See you soon", showTaxBreakdown: false, showCustomer: true, showCashier: false }), 200);
    expect((await w.as.cashier.get("/settings/receipt")).body.data).toEqual({ headerText: "Saffron Table, Gulberg", footerText: "See you soon", showTaxBreakdown: false, showCustomer: true, showCashier: false });
  });

  it("an alert reaches the bell until the person switches that kind off", async () => {
    const item = await must(owner.post("/inventory-items", { name: "Saffron", unit: "g", reorderLevel: 5 }));
    await must(owner.post("/inventory/adjustments", { locationId: w.pkr.id, itemId: item.id, type: "OPENING", qty: 10, unitCost: 100 }));
    await must(owner.post("/inventory/adjustments", { locationId: w.pkr.id, itemId: item.id, type: "WASTE", qty: 6, reason: "Spilt" })); // 10 -> 4, under its reorder level of 5
    const bell = async () => ((await owner.get("/notifications")).body.data as any[]).map((n) => n.type);
    expect(await bell()).toContain("LOW_STOCK");

    const prefs = (await owner.get("/settings/notifications")).body.data as any[];
    expect(prefs.map((p) => p.type)).toContain("LOW_STOCK");
    expect(prefs.every((p) => p.inApp)).toBe(true);
    await must(owner.put("/settings/notifications", { preferences: [{ type: "LOW_STOCK", inApp: false }] }), 200);
    expect((await owner.get("/settings/notifications")).body.data.find((p: any) => p.type === "LOW_STOCK").inApp).toBe(false);
    expect(await bell()).not.toContain("LOW_STOCK");
    await must(owner.put("/settings/notifications", { preferences: [{ type: "LOW_STOCK", inApp: true }] }), 200);
    expect(await bell()).toContain("LOW_STOCK");
  });
});
