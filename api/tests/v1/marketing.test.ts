import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { createFixture, createStaff, loginOwner, loginStaff, type Fixture } from "../helpers/fixtures.js";
import { api } from "../helpers/http.js";
import { buildSalesWorld, TYPICAL_SUBTOTAL, typicalOrder, type SalesWorld } from "../helpers/sales.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
const app = createApp();
let fx: Fixture;
let w: SalesWorld;
let owner: ReturnType<typeof api>;
let ali: any;
// someone who can take orders but holds NO discount right: coupons must work for them, manual discounts must not
let till: ReturnType<typeof api>;
const PHONE = "0300 123-4567";
const PHONE_CLEAN = "03001234567";

beforeAll(async () => {
  fx = await createFixture();
  w = await buildSalesWorld(fx, app);
  owner = api(app, (await loginOwner(app, fx)).token);
  const clerk = await createStaff(fx, { permissions: ["pos.access", "orders.view", "orders.create", "orders.update", "payments.take"], locationIds: [w.pkr.id] });
  till = api(app, (await loginStaff(app, clerk)).token);
}, 240_000);
afterAll(async () => {
  await fx.cleanup();
  await unscopedDb.$disconnect();
});

const must = async (p: Promise<any>, status = 201) => { const r = await p; expect(r.status, JSON.stringify(r.body?.error)).toBe(status); return r.body.data; };
const place = (over: Record<string, unknown>) => till.post("/orders", typicalOrder(w, over));
const finish = async (o: any) => {
  await must(owner.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.card, tenderedMinor: o.totalMinor, reference: "S" }));
  for (const status of ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]) await owner.post(`/orders/${o.id}/status`, { status });
};

describe("customers", () => {
  it("are saved with a normalised phone number, one per number", async () => {
    ali = await must(owner.post("/customers", { name: "Ali Raza", phone: PHONE, email: "", marketingOptIn: true }));
    expect(ali.phone).toBe(PHONE_CLEAN);
    expect((await owner.post("/customers", { name: "Other Ali", phone: "03001234567" })).status).toBe(409);
    expect((await w.as.cashier.post("/customers", { name: "Nope" })).status).toBe(403);
  });
});

describe("coupons at the till", () => {
  it("are checked by the server: a cashier without discount rights can use one, and cannot invent an amount", async () => {
    await must(owner.post("/coupons", { code: "SAVE10", valueType: "PERCENT", value: 10, minSubtotalMinor: 10_000, maxUses: 1 }));
    expect((await owner.post("/coupons", { code: "save10", valueType: "PERCENT", value: 5 })).status).toBe(409); // code unique ignoring case
    expect((await owner.post("/coupons", { code: "TOOBIG", valueType: "PERCENT", value: 150 })).status).toBe(422);
    expect((await w.as.cashier.post("/coupons", { code: "MINE", valueType: "AMOUNT", value: 100 })).status).toBe(403);

    const check = (await w.as.cashier.post("/offers/coupon-check", { code: "save10", locationId: w.pkr.id, subtotalMinor: 452_000 })).body.data;
    expect(check).toMatchObject({ valid: true, valueType: "PERCENT", value: 10 });
    expect((await w.as.cashier.post("/offers/coupon-check", { code: "NOPE", locationId: w.pkr.id })).body.data.valid).toBe(false);

    expect((await till.post("/orders", typicalOrder(w, { discount: { type: "PERCENT", value: 10, reasonId: w.reasons.discount } }))).status).toBe(403); // a manual discount still needs the right
    const both = await place({ offer: { couponCode: "SAVE10" }, discount: { type: "PERCENT", value: 50, reasonId: w.reasons.discount } });
    expect(both.status).toBe(422); // one or the other

    const o = await place({ offer: { couponCode: "save10" } });
    expect(o.status, JSON.stringify(o.body?.error)).toBe(201);
    expect(o.body.data.discountMinor).toBe(Math.round(TYPICAL_SUBTOTAL * 0.1)); // 45,200, decided by the server
    expect(o.body.data.discounts[0]).toMatchObject({ source: "COUPON", valueType: "PERCENT", value: 1000 });
  });

  it("is counted once an order completes, and a used-up coupon is refused", async () => {
    await must(owner.put("/loyalty/program", { isEnabled: true, earnPerPointMinor: 10_000, redeemValueMinor: 100, minRedeemPoints: 5 }), 200);
    const o = await must(till.post("/orders", typicalOrder(w, { offer: { couponCode: "SAVE10" }, customerName: "Ali Raza", customerPhone: PHONE })));
    const used = (await owner.get("/coupons?q=SAVE10")).body.data[0];
    expect(used.usedCount).toBe(0); // placing is not using
    await finish(o);
    expect((await owner.get("/coupons?q=SAVE10")).body.data[0].usedCount).toBe(1);
    const again = await place({ offer: { couponCode: "SAVE10" } });
    expect(again.status).toBe(422);
    expect(JSON.stringify(again.body.error)).toContain("used up");
  });

  it("a coupon with a minimum spend refuses a smaller order", async () => {
    await must(owner.post("/coupons", { code: "BIGSPEND", valueType: "AMOUNT", value: 50_000, minSubtotalMinor: 10_000_000 }));
    expect((await place({ offer: { couponCode: "BIGSPEND" } })).status).toBe(422);
  });
});

describe("customers and loyalty", () => {
  it("completing an order remembers the customer's history and earns points on what they spent", async () => {
    const profile = (await owner.get(`/customers/${ali.id}/profile`)).body.data;
    expect(profile.orderCount).toBe(1);
    expect(Object.keys(profile.spendByCurrency)).toEqual(["PKR"]);
    expect(profile.customer.loyaltyPoints).toBe(40); // net 406,800 at 1 point per 10,000
    expect(profile.ledger[0]).toMatchObject({ type: "EARN", points: 40, balanceAfter: 40 });
    expect(profile.recentOrders[0].number).toMatch(/^KH-/);
    const all = (await owner.get("/customers?pageSize=50")).body.data as any[];
    expect(all.filter((c) => c.phone === PHONE_CLEAN)).toHaveLength(1); // still one Ali
  });

  it("points can be adjusted with a reason and never go below zero", async () => {
    expect((await owner.post(`/customers/${ali.id}/loyalty`, { points: 10 })).status).toBe(422); // why?
    await must(owner.post(`/customers/${ali.id}/loyalty`, { points: 10, note: "Birthday gift" }));
    expect((await owner.post(`/customers/${ali.id}/loyalty`, { points: -500, note: "Oops" })).status).toBe(409);
    expect((await owner.get(`/customers/${ali.id}/profile`)).body.data.customer.loyaltyPoints).toBe(50);
  });

  it("points are redeemed into a one-customer coupon worth their value", async () => {
    expect((await owner.post(`/customers/${ali.id}/redeem`, { points: 3 })).status).toBe(422); // under the minimum of 5
    expect((await owner.post(`/customers/${ali.id}/redeem`, { points: 500 })).status).toBe(422); // more than they have
    const r = await must(owner.post(`/customers/${ali.id}/redeem`, { points: 30 }));
    expect(r).toMatchObject({ valueMinor: 3_000, balance: 20 });
    const stranger = await place({ offer: { couponCode: r.code }, customerPhone: "03119999999" });
    expect(stranger.status).toBe(422); // tied to Ali's phone
    const mine = await place({ offer: { couponCode: r.code }, customerPhone: PHONE });
    expect(mine.status, JSON.stringify(mine.body?.error)).toBe(201);
    expect(mine.body.data.discountMinor).toBe(3_000);
  });

  it("the points ledger cannot be edited", async () => {
    const row = await unscopedDb.loyaltyTransaction.findFirst({ where: { tenantId: fx.tenantId } });
    await expect(unscopedDb.loyaltyTransaction.update({ where: { id: row!.id }, data: { points: 9999 } })).rejects.toThrow();
  });
});

describe("promotions", () => {
  it("run when they should: listed and applicable at the right branch, hidden elsewhere and when off", async () => {
    const hh = await must(owner.post("/promotions", { name: "Happy hour", valueType: "PERCENT", value: 20 }));
    await must(owner.post("/promotions", { name: "Dubai only", valueType: "PERCENT", value: 50, locationIds: [w.aed.id] }));
    await must(owner.post("/promotions", { name: "Switched off", valueType: "PERCENT", value: 30, isActive: false }));
    expect((await owner.post("/promotions", { name: "Half a window", valueType: "PERCENT", value: 5, startTime: "10:00" })).status).toBe(422);
    const listed = (await w.as.cashier.get(`/offers/promotions?locationId=${w.pkr.id}&subtotalMinor=${TYPICAL_SUBTOTAL}`)).body.data as any[];
    expect(listed.map((p) => p.name)).toEqual(["Happy hour"]);
    expect(listed[0]).toMatchObject({ value: 20, eligible: true });

    const o = await place({ offer: { promotionId: hh.id } });
    expect(o.status, JSON.stringify(o.body?.error)).toBe(201);
    expect(o.body.data.discountMinor).toBe(Math.round(TYPICAL_SUBTOTAL * 0.2));
    expect(o.body.data.discounts[0]).toMatchObject({ source: "PROMOTION" });
    const dubaiOnly = ((await owner.get("/promotions?q=Dubai")).body.data as any[])[0];
    expect((await place({ offer: { promotionId: dubaiOnly.id } })).status).toBe(422); // not at this branch
  });

  it("a promotion with a time window only runs inside it", async () => {
    const now = new Date();
    const tz = "Asia/Karachi";
    const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    const past = await must(owner.post("/promotions", { name: "Earlier today", valueType: "AMOUNT", value: 1_000, startTime: hhmm(new Date(now.getTime() - 3 * 3_600_000)), endTime: hhmm(new Date(now.getTime() - 2 * 3_600_000)) }));
    const live = await must(owner.post("/promotions", { name: "Right now", valueType: "AMOUNT", value: 1_000, startTime: hhmm(new Date(now.getTime() - 3_600_000)), endTime: hhmm(new Date(now.getTime() + 3_600_000)) }));
    const names = ((await w.as.cashier.get(`/offers/promotions?locationId=${w.pkr.id}`)).body.data as any[]).map((p) => p.name);
    expect(names).toContain("Right now");
    expect(names).not.toContain("Earlier today");
    expect((await place({ offer: { promotionId: past.id } })).status).toBe(422);
    expect((await place({ offer: { promotionId: live.id } })).status).toBe(201);
  });
});

describe("feedback", () => {
  it("is recorded with a rating, answered, and summarised", async () => {
    const f = await must(owner.post("/feedback", { locationId: w.pkr.id, rating: 2, comment: "Cold fries", customerId: ali.id }));
    await must(owner.post("/feedback", { locationId: w.pkr.id, rating: 5 }));
    expect((await owner.post("/feedback", { locationId: w.pkr.id, rating: 6 })).status).toBe(422);
    const s = (await owner.get("/feedback/summary")).body.data;
    expect(s).toMatchObject({ total: 2, average: 3.5, newCount: 2 });
    expect(s.distribution.find((d: any) => d.rating === 2).count).toBe(1);
    expect(((await owner.get("/feedback?maxRating=3")).body.data as any[]).map((x) => x.comment)).toEqual(["Cold fries"]);
    const replied = await must(owner.post(`/feedback/${f.id}/reply`, { reply: "Sorry! A free portion is on us next time." }), 200);
    expect(replied).toMatchObject({ status: "REPLIED" });
    await must(owner.post(`/feedback/${f.id}/resolve`, {}), 200);
    expect((await owner.get("/feedback/summary")).body.data.newCount).toBe(1);
    expect(((await owner.get("/feedback?status=RESOLVED")).body.data as any[])[0]).toMatchObject({ customerName: "Ali Raza", locationName: expect.any(String) });
  });
});
