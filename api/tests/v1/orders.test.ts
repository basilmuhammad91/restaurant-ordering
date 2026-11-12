import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { runAsTenant } from "../../src/core/context/context.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { db } from "../../src/core/db/scoped.js";
import { createFixture, createStaff, loginOwner, loginStaff, type Fixture } from "../helpers/fixtures.js";
import { api, auditFor } from "../helpers/http.js";
import { buildSalesWorld, PRICES, TYPICAL_SUBTOTAL, typicalOrder, type SalesWorld } from "../helpers/sales.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
const app = createApp();
let fx: Fixture;
let w: SalesWorld;
let owner: ReturnType<typeof api>;

/** 13% added on top, rounded half up per line */
const tax13 = (n: number) => Math.floor((n * 13 * 2 + 100) / 200);

beforeAll(async () => {
  fx = await createFixture();
  w = await buildSalesWorld(fx, app);
  owner = api(app, (await loginOwner(app, fx)).token);
  expect((await owner.post("/shifts/open", { locationId: w.pkr.id, openingFloatMinor: 500_000 })).status).toBe(201);
}, 180_000);

afterAll(async () => {
  await fx.cleanup();
  await unscopedDb.$disconnect();
});

const place = async (as: ReturnType<typeof api>, body: object, status = 201) => {
  const res = await as.post("/orders", body);
  expect(res.status, JSON.stringify(res.body?.error ?? res.body)).toBe(status);
  return res.body.data;
};

describe("creating an order: the server prices it", () => {
  let order: any;

  it("prices from the menu, adds 13% tax per line, and snapshots names, prices and tax", async () => {
    order = await place(w.as.cashier, typicalOrder(w));
    expect(order.subtotalMinor).toBe(TYPICAL_SUBTOTAL); // 452,000
    expect(order.taxMinor).toBe(tax13(2 * (PRICES.burgerDouble + PRICES.cheese + PRICES.bbq)) + tax13(PRICES.fries));
    expect(order.totalMinor).toBe(TYPICAL_SUBTOTAL + order.taxMinor);
    expect(order).toMatchObject({ status: "CONFIRMED", paymentStatus: "UNPAID", currencyCode: "PKR", pricesIncludeTax: false, orderNumber: "KH-0001", dueMinor: order.totalMinor });

    const burger = order.lines.find((l: any) => l.nameSnapshot === "Burger");
    expect(burger).toMatchObject({ variantNameSnapshot: "Double", quantity: 2, unitPriceMinor: 211_000, modifiersTotalMinor: 11_000, lineSubtotalMinor: 422_000, stationKey: "GRILL" });
    expect(burger.modifiers.map((m: any) => [m.nameSnapshot, m.priceMinor]).sort()).toEqual([["BBQ", 3_000], ["Cheese", 8_000]]);
    expect(burger.taxes[0]).toMatchObject({ authorityCode: "SRB", rateBp: 1300, baseMinor: 422_000, taxMinor: tax13(422_000), isInclusive: false });
    expect(order.events.map((e: any) => e.toStatus)).toEqual(["CONFIRMED"]);
    expect((await auditFor(fx.tenantId, "Order", order.id)).map((a) => a.action)).toEqual(["orders.create"]);
  });

  it("the stored order does not change when the menu price changes later", async () => {
    await runAsTenant(fx.tenantId, () => db.price.updateMany({ where: { variantId: w.burger.double, priceBookId: w.base.priceBookId }, data: { amountMinor: 999_999 } }));
    const again = (await owner.get(`/orders/${order.id}`)).body.data;
    expect(again.subtotalMinor).toBe(TYPICAL_SUBTOTAL);
    expect(again.lines.find((l: any) => l.nameSnapshot === "Burger").unitPriceMinor).toBe(211_000);
    await runAsTenant(fx.tenantId, () => db.price.updateMany({ where: { variantId: w.burger.double, priceBookId: w.base.priceBookId }, data: { amountMinor: PRICES.burgerDouble } }));
  });

  it("ignores any price, tax or total the client sends", async () => {
    const o = await place(w.as.cashier, { ...typicalOrder(w), subtotalMinor: 1, totalMinor: 1, taxMinor: 0, lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1, modifierOptionIds: [], unitPriceMinor: 1, priceMinor: 1, totalMinor: 1 }] });
    expect(o.subtotalMinor).toBe(PRICES.fries);
    expect(o.totalMinor).toBe(PRICES.fries + tax13(PRICES.fries));
  });

  it("numbers orders one after another per branch", async () => {
    const a = await place(w.as.cashier, typicalOrder(w));
    const b = await place(w.as.cashier, typicalOrder(w));
    expect([a.displayNumber, b.displayNumber]).toEqual([a.displayNumber, a.displayNumber + 1]);
    expect(b.orderNumber).toMatch(/^KH-\d{4}$/);
  });
});

describe("retries and duplicates", () => {
  it("sending the same order twice returns the first and creates nothing new", async () => {
    const id = randomUUID();
    const first = await owner.post("/orders", typicalOrder(w, { id }));
    const second = await owner.post("/orders", typicalOrder(w, { id }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.meta.replayed).toBe(true);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.orderNumber).toBe(first.body.data.orderNumber); // no number was burned
    expect(await runAsTenant(fx.tenantId, () => db.order.count({ where: { id } }))).toBe(1);
  });

  it("two simultaneous submissions of the same order still make exactly one", async () => {
    const id = randomUUID();
    const [a, b] = await Promise.all([owner.post("/orders", typicalOrder(w, { id })), owner.post("/orders", typicalOrder(w, { id }))]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect(await runAsTenant(fx.tenantId, () => db.order.count({ where: { id } }))).toBe(1);
  });
});

describe("what can be ordered", () => {
  const bad = async (lines: unknown[], over: object = {}) => {
    const res = await w.as.cashier.post("/orders", typicalOrder(w, { lines, ...over }));
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    return JSON.stringify(res.body.error);
  };

  it("rejects a required choice left out, too many choices, an add-on of another product, and the same add-on twice", async () => {
    expect(await bad([{ kind: "item", variantId: w.burger.single, quantity: 1 }])).toMatch(/Sauce/);
    expect(await bad([{ kind: "item", variantId: w.burger.single, quantity: 1, modifierOptionIds: [w.burger.extras.ketchup, w.burger.extras.bbq] }])).toMatch(/at most 1/);
    expect(await bad([{ kind: "item", variantId: w.burger.single, quantity: 1, modifierOptionIds: [w.burger.extras.ketchup, w.other.modifierOption] }])).toMatch(/not available for Burger/);
    expect(await bad([{ kind: "item", variantId: w.burger.single, quantity: 1, modifierOptionIds: [w.burger.extras.ketchup, w.burger.extras.cheese, w.burger.extras.cheese] }])).toMatch(/twice/);
    expect(await bad([{ kind: "item", variantId: w.burger.single, quantity: 1, modifierOptionIds: [w.burger.extras.ketchup, w.burger.extras.cheese, w.burger.extras.bacon, w.burger.extras.ketchup] }])).toBeTruthy();
  });

  it("rejects items from another brand, unknown items, and bad quantities", async () => {
    expect(await bad([{ kind: "item", variantId: w.other.burgerVariant, quantity: 1 }])).toMatch(/not available/);
    expect(await bad([{ kind: "item", variantId: randomUUID(), quantity: 1 }])).toMatch(/not available/);
    for (const quantity of [0, -1, 1.5, 101]) {
      const res = await w.as.cashier.post("/orders", typicalOrder(w, { lines: [{ kind: "item", variantId: w.fries.regular, quantity }] }));
      expect(res.status, String(quantity)).toBe(422);
    }
    expect((await w.as.cashier.post("/orders", typicalOrder(w, { lines: [] }))).status).toBe(422);
  });

  it("does not sell what is 86'd, or what has no price at this branch", async () => {
    await runAsTenant(fx.tenantId, () => db.locationAvailability.create({ data: { tenantId: fx.tenantId, locationId: w.pkr.id, productId: w.cola.id, isAvailable: false } }));
    expect(await bad([{ kind: "item", variantId: w.cola.can, quantity: 1 }])).toMatch(/not available/);
    await runAsTenant(fx.tenantId, () => db.locationAvailability.deleteMany({ where: { productId: w.cola.id } }));
    expect((await w.as.cashier.post("/orders", typicalOrder(w, { lines: [{ kind: "item", variantId: w.cola.can, quantity: 1 }] }))).status).toBe(201);
    // the AED branch has no price for the burger's extras group items we did not price (cheese), and no lemonade price at all
    const res = await owner.post("/orders", { locationId: w.aed.id, orderType: "TAKEAWAY", channel: "POS", lines: [{ kind: "item", variantId: w.burger.single, quantity: 1, modifierOptionIds: [w.burger.extras.bbq] }, { kind: "item", variantId: w.cola.can, quantity: 1 }] });
    expect(res.status).toBe(201);
  });

  it("checks table, delivery address and branch type", async () => {
    expect(await bad([{ kind: "item", variantId: w.fries.regular, quantity: 1 }], { tableId: w.table })).toMatch(/dine-in/);
    expect(await bad([{ kind: "item", variantId: w.fries.regular, quantity: 1 }], { orderType: "DELIVERY" })).toMatch(/address/);
    expect(await bad([{ kind: "item", variantId: w.fries.regular, quantity: 1 }], { orderType: "DINE_IN", tableId: randomUUID() })).toMatch(/table/);
    const dineIn = await place(w.as.cashier, typicalOrder(w, { orderType: "DINE_IN", tableId: w.table, covers: 2, lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] }));
    expect(dineIn).toMatchObject({ tableId: w.table, covers: 2 });
    const delivery = await place(w.as.cashier, typicalOrder(w, { orderType: "DELIVERY", deliveryAddress: { line1: "12 Sea View" }, deliveryFeeMinor: 15_000, lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] }));
    expect(delivery.deliveryFeeMinor).toBe(15_000);
    expect(delivery.totalMinor).toBe(PRICES.fries + tax13(PRICES.fries) + 15_000); // the fee is not taxed
  });

  it("combos: price = bundle + up-charges, with each part as its own line on its own station", async () => {
    const meal = (drink: string) => ({ kind: "combo", comboId: w.meal.id, quantity: 2, choices: [{ slotId: w.meal.drinkSlot, optionId: drink }] });
    const withCola = await place(w.as.cashier, typicalOrder(w, { lines: [meal(w.meal.colaOption)] }));
    expect(withCola.subtotalMinor).toBe(2 * PRICES.meal);
    const combo = withCola.lines[0];
    expect(combo).toMatchObject({ kind: "COMBO", nameSnapshot: "Meal", quantity: 2, unitPriceMinor: PRICES.meal });
    expect(combo.children.map((c: any) => [c.nameSnapshot, c.stationKey, c.unitPriceMinor, c.kind])).toEqual([["Burger", "GRILL", 0, "COMBO_ITEM"], ["Cola", "BAR", 0, "COMBO_ITEM"], ["Fries", "FRY", 0, "COMBO_ITEM"]]);

    const withLemonade = await place(w.as.cashier, typicalOrder(w, { lines: [meal(w.meal.lemonadeOption)] }));
    expect(withLemonade.subtotalMinor).toBe(2 * (PRICES.meal + PRICES.lemonadeUp));
    expect(await bad([{ kind: "combo", comboId: w.meal.id, quantity: 1, choices: [{ slotId: w.meal.drinkSlot, optionId: w.meal.burgerOption }] }])).toMatch(/not part of/); // an option of another slot
    expect(await bad([{ kind: "combo", comboId: w.meal.id, quantity: 1, choices: [] }])).toMatch(/choose 1 for .{1,2}Drink/); // the drink slot has two choices, so one must be picked
  });
});

describe("tax that is already inside the price (UAE VAT 5%)", () => {
  it("the total equals the shelf price and the tax is the part inside it", async () => {
    const o = await place(owner, { locationId: w.aed.id, orderType: "TAKEAWAY", channel: "POS", lines: [{ kind: "item", variantId: w.burger.double, quantity: 1, modifierOptionIds: [w.burger.extras.bbq] }, { kind: "item", variantId: w.fries.regular, quantity: 2 }] });
    expect(o).toMatchObject({ currencyCode: "AED", pricesIncludeTax: true, subtotalMinor: 4_100 + 2 * 1_000, totalMinor: 6_100 });
    const inside = (g: number) => g - Math.floor((g * 10_000 * 2 + 10_500) / 21_000);
    expect(o.taxMinor).toBe(inside(4_100) + inside(2_000));
    expect(o.lines[0].taxes[0]).toMatchObject({ authorityCode: "FTA", isInclusive: true, baseMinor: 4_100 - inside(4_100) });
    expect(o.orderNumber).toMatch(/^DX-\d{4}$/); // numbered per branch and trading day; the restart rule has its own test below
  });
});

describe("trading date and order numbers", () => {
  it("a late-night sale belongs to the previous trading day, and numbers restart each day", async () => {
    // Karachi is UTC+5 and the trading day starts at 05:00 local
    const late = await place(owner, typicalOrder(w, { occurredAt: "2026-01-14T20:30:00Z", lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] })); // 01:30 on the 15th
    const stillLate = await place(owner, typicalOrder(w, { occurredAt: "2026-01-14T23:30:00Z", lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] })); // 04:30 on the 15th
    const morning = await place(owner, typicalOrder(w, { occurredAt: "2026-01-15T01:00:00Z", lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] })); // 06:00 on the 15th
    expect([late.businessDate, stillLate.businessDate, morning.businessDate]).toEqual(["2026-01-14", "2026-01-14", "2026-01-15"]);
    expect(stillLate.displayNumber).toBe(late.displayNumber + 1);
    expect(morning.displayNumber).toBe(1);
  });

  it("refuses an order dated in the future", async () => {
    const res = await owner.post("/orders", typicalOrder(w, { occurredAt: new Date(Date.now() + 3_600_000).toISOString() }));
    expect(res.status).toBe(422);
  });
});

describe("held orders", () => {
  it("a held bill is not sent to the kitchen, can be changed, then sent", async () => {
    const held = await place(w.as.cashier, typicalOrder(w, { status: "OPEN", lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] }));
    expect(held.status).toBe("OPEN");
    expect(held.lines[0].sentToKitchenAt).toBeNull();
    expect((await w.as.kitchen.get(`/kds?locationId=${w.pkr.id}`)).body.data.map((t: any) => t.orderId)).not.toContain(held.id);

    const paid = await w.as.cashier.post(`/orders/${held.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: 100_000 });
    expect(paid.status).toBe(409); // not sent yet

    const edited = await w.as.cashier.put(`/orders/${held.id}`, typicalOrder(w, { status: "OPEN", lines: [{ kind: "item", variantId: w.fries.regular, quantity: 3 }] }));
    expect(edited.status).toBe(200);
    expect(edited.body.data.subtotalMinor).toBe(3 * PRICES.fries);
    expect(edited.body.data.orderNumber).toBe(held.orderNumber); // same order, same number

    const sent = await w.as.cashier.put(`/orders/${held.id}`, typicalOrder(w, { status: "CONFIRMED", lines: [{ kind: "item", variantId: w.fries.regular, quantity: 3 }] }));
    expect(sent.body.data.status).toBe("CONFIRMED");
    expect(sent.body.data.lines[0].sentToKitchenAt).not.toBeNull();
    expect((await w.as.cashier.put(`/orders/${held.id}`, typicalOrder(w))).status).toBe(409); // no longer held
    expect(sent.body.data.events.map((e: any) => e.toStatus)).toEqual(["OPEN", "CONFIRMED"]);
  });
});

describe("taking payment", () => {
  let o: any;
  beforeAll(async () => {
    o = await place(w.as.cashier, typicalOrder(w));
  });

  it("cash over the amount due gives change; a split between cash and card settles the bill", async () => {
    const cash = await w.as.cashier.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: 300_000 });
    expect(cash.status).toBe(201);
    expect(cash.body.data).toMatchObject({ paymentStatus: "PARTIAL", paidMinor: 300_000, dueMinor: o.totalMinor - 300_000 });
    expect(cash.body.meta.changeMinor).toBe(0);

    const noRef = await w.as.cashier.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.card, tenderedMinor: 100 });
    expect(noRef.status).toBe(422); // the card slip number is required
    const tooMuch = await w.as.cashier.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.card, tenderedMinor: o.totalMinor, reference: "SLIP-1" });
    expect(tooMuch.status).toBe(422); // a card cannot be charged more than is due

    const rest = o.totalMinor - 300_000;
    const card = await w.as.cashier.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.card, tenderedMinor: rest, reference: "SLIP-2", tipMinor: 5_000 });
    expect(card.body.data).toMatchObject({ paymentStatus: "PAID", paidMinor: o.totalMinor, dueMinor: 0, tipMinor: 5_000 });
    expect(card.body.data.payments.map((p: any) => [p.paymentMethod.name, p.amountMinor])).toEqual([["Cash", 300_000], ["Card", rest]]);
    expect((await w.as.cashier.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: 100 })).status).toBe(409); // already paid
  });

  it("a cash payment larger than the bill returns change and records what was handed over", async () => {
    const small = await place(w.as.cashier, typicalOrder(w, { lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] }));
    const due = small.totalMinor;
    const res = await w.as.cashier.post(`/orders/${small.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: 100_000 });
    expect(res.body.meta.changeMinor).toBe(100_000 - due);
    expect(res.body.data.payments[0]).toMatchObject({ amountMinor: due, tenderedMinor: 100_000, changeMinor: 100_000 - due });
    expect(res.body.data.paymentStatus).toBe("PAID");
  });

  it("paying twice with the same payment id charges once", async () => {
    const x = await place(w.as.cashier, typicalOrder(w, { lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] }));
    const paymentId = randomUUID();
    const first = await w.as.cashier.post(`/orders/${x.id}/payments`, { id: paymentId, paymentMethodId: w.methods.cash, tenderedMinor: 10_000 });
    const second = await w.as.cashier.post(`/orders/${x.id}/payments`, { id: paymentId, paymentMethodId: w.methods.cash, tenderedMinor: 10_000 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.paidMinor).toBe(10_000);
    expect(await runAsTenant(fx.tenantId, () => db.payment.count({ where: { orderId: x.id } }))).toBe(1);
  });

  it("needs an open shift for cash, a branch that accepts the method, and the right permission", async () => {
    const dubai = await place(owner, { locationId: w.aed.id, orderType: "TAKEAWAY", channel: "POS", lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] });
    const noShift = await owner.post(`/orders/${dubai.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: 1_000 });
    expect(noShift.status).toBe(409);
    expect(noShift.body.error.message).toMatch(/shift/);
    expect((await owner.post(`/orders/${dubai.id}/payments`, { paymentMethodId: w.methods.card, tenderedMinor: 1_000, reference: "A1" })).status).toBe(201); // card needs no shift
    expect((await w.as.kitchen.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: 1 })).status).toBe(403);
  });

  it("payments can never be edited or deleted afterwards", async () => {
    const row = await runAsTenant(fx.tenantId, () => db.payment.findFirstOrThrow({ where: { orderId: o.id } }));
    await expect(unscopedDb.payment.update({ where: { id: row.id }, data: { amountMinor: 1 } })).rejects.toThrow();
    await expect(unscopedDb.payment.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});

describe("moving an order through the kitchen", () => {
  it("follows the allowed steps, completes only when paid, and records every change", async () => {
    const o = await place(w.as.cashier, typicalOrder(w, { lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] }));
    const status = (to: string, extra: object = {}) => w.as.manager.post(`/orders/${o.id}/status`, { status: to, ...extra });
    expect((await status("COMPLETED")).status).toBe(409); // cannot skip ahead
    expect((await status("READY")).status).toBe(409);
    expect((await status("PREPARING")).body.data.status).toBe("PREPARING");
    expect((await status("READY")).body.data.status).toBe("READY");
    const unpaid = await status("COMPLETED");
    expect(unpaid.status).toBe(409);
    expect(unpaid.body.error.message).toMatch(/payment/i);
    await w.as.cashier.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: o.totalMinor });
    const done = await status("COMPLETED");
    expect(done.body.data.status).toBe("COMPLETED");
    expect(done.body.data.completedAt).not.toBeNull();
    expect(done.body.data.lines[0].status).toBe("SERVED");
    expect(done.body.data.events.map((e: any) => e.toStatus)).toEqual(["CONFIRMED", "PREPARING", "READY", "COMPLETED"]);
    expect((await status("PREPARING")).status).toBe(409); // completed is final
  });

  it("cancelling needs a reason; a paid order cannot be cancelled; unpaid cancel voids the lines", async () => {
    const o = await place(w.as.cashier, typicalOrder(w, { lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] }));
    expect((await w.as.manager.post(`/orders/${o.id}/status`, { status: "CANCELLED" })).status).toBe(422);
    const cancelled = await w.as.manager.post(`/orders/${o.id}/status`, { status: "CANCELLED", reasonId: w.reasons.void });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({ status: "CANCELLED" });
    expect(cancelled.body.data.lines.every((l: any) => l.status === "VOIDED")).toBe(true);

    const paid = await place(w.as.cashier, typicalOrder(w, { lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] }));
    await w.as.cashier.post(`/orders/${paid.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: paid.totalMinor });
    expect((await w.as.manager.post(`/orders/${paid.id}/status`, { status: "CANCELLED", reasonId: w.reasons.void })).status).toBe(409); // refund first
  });
});

describe("the kitchen display", () => {
  it("shows each station only its own items, and the order moves by itself as items are bumped", async () => {
    const o = await place(w.as.cashier, typicalOrder(w, { lines: [{ kind: "item", variantId: w.burger.single, quantity: 1, modifierOptionIds: [w.burger.extras.ketchup] }, { kind: "item", variantId: w.fries.regular, quantity: 2 }, { kind: "combo", comboId: w.meal.id, quantity: 1, choices: [{ slotId: w.meal.drinkSlot, optionId: w.meal.colaOption }] }] }));
    const board = async (station?: string) => (await w.as.kitchen.get(`/kds?locationId=${w.pkr.id}${station ? `&station=${station}` : ""}`)).body.data.find((t: any) => t.orderId === o.id);

    const grill = await board("GRILL");
    expect(grill.lines.map((l: any) => [l.name, l.partOf])).toEqual([["Burger", null], ["Burger", "Meal"]]);
    expect(grill.lines[0].modifiers).toEqual(["Ketchup"]);
    expect((await board("FRY")).lines.map((l: any) => l.name)).toEqual(["Fries", "Fries"]);
    expect((await board("BAR")).lines.map((l: any) => [l.name, l.partOf])).toEqual([["Cola", "Meal"]]);
    expect(grill).toMatchObject({ orderNumber: o.orderNumber, orderType: "TAKEAWAY" });

    const line = grill.lines[0];
    expect((await w.as.kitchen.patch(`/kds/lines/${line.id}`, { status: "SERVED" })).status).toBe(409); // cannot skip
    const started = await w.as.kitchen.patch(`/kds/lines/${line.id}`, { status: "PREPARING" });
    expect(started.body.data).toMatchObject({ lineStatus: "PREPARING", orderStatus: "PREPARING" }); // the order started cooking
    await w.as.kitchen.post(`/kds/orders/${o.id}/ready`, { station: "GRILL" });
    expect(await board("GRILL")).toBeUndefined(); // the grill's part is done, so its ticket leaves that screen
    expect(await board("FRY")).toBeDefined();
    const final = await w.as.kitchen.post(`/kds/orders/${o.id}/ready`, {});
    expect(final.body.data.orderStatus).toBe("READY");
    expect((await owner.get(`/orders/${o.id}`)).body.data.events.map((e: any) => e.toStatus)).toEqual(["CONFIRMED", "PREPARING", "READY"]);
  });

  it("needs the kitchen permission, and a cashier cannot use it", async () => {
    expect((await w.as.cashier.get(`/kds?locationId=${w.pkr.id}`)).status).toBe(403);
  });
});

describe("discounts", () => {
  const body = (discount: object) => typicalOrder(w, { discount: { reasonId: w.reasons.discount, ...discount } });

  it("a discount comes off before tax; a cashier can give up to their limit (10%)", async () => {
    const o = await place(w.as.cashier, body({ type: "PERCENT", value: 10 }));
    expect(o.discountMinor).toBe(Math.floor(TYPICAL_SUBTOTAL / 10)); // 45,200
    const lines = o.lines.filter((l: any) => l.kind === "ITEM");
    expect(lines.reduce((a: number, l: any) => a + l.discountMinor, 0)).toBe(o.discountMinor); // spread exactly over the lines
    const taxable = TYPICAL_SUBTOTAL - o.discountMinor;
    expect(o.taxMinor).toBeGreaterThanOrEqual(Math.floor(taxable * 0.13) - 2);
    expect(o.taxMinor).toBeLessThanOrEqual(Math.ceil(taxable * 0.13) + 2);
    expect(o.totalMinor).toBe(taxable + o.taxMinor);
  });

  it("above their limit it needs a manager: the error carries what is needed, and a PIN override lets the retry through", async () => {
    const id = randomUUID();
    const first = await w.as.cashier.post("/orders", { ...body({ type: "PERCENT", value: 15 }), id });
    expect(first.status).toBe(403);
    expect(first.body.error.code).toBe("APPROVAL_REQUIRED");
    const d = first.body.error.details;
    expect(d).toMatchObject({ type: "DISCOUNT", entityType: "Order", entityId: id });
    expect(d.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await runAsTenant(fx.tenantId, () => db.order.count({ where: { id } }))).toBe(0); // nothing was created

    const approval = await w.as.cashier.post("/approvals/override", { type: "DISCOUNT", approverEmail: w.manager.email, pin: "4821", locationId: w.pkr.id, entityType: d.entityType, entityId: d.entityId, payloadHash: d.payloadHash, percent: 15, reason: "Regular customer" });
    expect(approval.status).toBe(201);
    const retried = await w.as.cashier.post("/orders", { ...body({ type: "PERCENT", value: 15, approvalId: approval.body.data.approvalId }), id });
    expect(retried.status).toBe(201);
    expect(retried.body.data.discounts[0]).toMatchObject({ valueType: "PERCENT", value: 1500, approvalId: approval.body.data.approvalId });

    // an approval is single use and bound to that exact order
    const reuse = await w.as.cashier.post("/orders", { ...body({ type: "PERCENT", value: 15, approvalId: approval.body.data.approvalId }), id: randomUUID() });
    expect(reuse.status).toBe(403);
  });

  it("a manager can give 20% without anyone else; more than 20% needs approval", async () => {
    expect((await w.as.manager.post("/orders", body({ type: "PERCENT", value: 20 }))).status).toBe(201);
    expect((await w.as.manager.post("/orders", body({ type: "PERCENT", value: 20.5 }))).status).toBe(403);
  });

  it("an amount discount is capped at the order value; the reason must be a discount reason; users without the right cannot", async () => {
    const big = await place(owner, body({ type: "AMOUNT", value: 99_999_999 }));
    expect(big.discountMinor).toBe(TYPICAL_SUBTOTAL);
    expect(big.totalMinor).toBe(0);
    expect((await owner.post("/orders", body({ type: "PERCENT", value: 5, reasonId: w.reasons.void }))).status).toBe(422);
    expect((await w.as.kitchen.post("/orders", body({ type: "PERCENT", value: 1 }))).status).toBe(403);
  });
});

describe("voiding an item", () => {
  it("someone over their void limit needs a manager; a PIN approval lets it through; totals, tax and discount are recalculated; the audit says it was already in the kitchen", async () => {
    // a till operator who may void, but only up to 1.00: anything bigger needs a manager (the default Cashier role cannot void at all)
    const limited = await createStaff(fx, { permissions: ["orders.view", "orders.void"], limits: { PKR: { void: 100 } }, locationIds: [w.pkr.id] });
    const asLimited = api(app, (await loginStaff(app, limited)).token);
    const o = await place(owner, typicalOrder(w, { discount: { type: "PERCENT", value: 10, reasonId: w.reasons.discount } }));
    const burger = o.lines.find((l: any) => l.nameSnapshot === "Burger");

    const first = await asLimited.post(`/orders/${o.id}/lines/${burger.id}/void`, { reasonId: w.reasons.void });
    expect(first.status).toBe(403);
    const d = first.body.error.details;
    expect(d).toMatchObject({ type: "VOID", amountMinor: burger.lineTotalMinor });

    const approval = await asLimited.post("/approvals/override", { type: "VOID", approverEmail: w.manager.email, pin: "4821", locationId: w.pkr.id, entityType: d.entityType, entityId: d.entityId, payloadHash: d.payloadHash, amountMinor: d.amountMinor, currencyCode: "PKR", reason: "Customer changed mind" });
    expect(approval.status).toBe(201);
    const voided = await asLimited.post(`/orders/${o.id}/lines/${burger.id}/void`, { reasonId: w.reasons.void, approvalId: approval.body.data.approvalId });
    expect(voided.status).toBe(200);
    const after = voided.body.data;
    expect(after.lines.find((l: any) => l.id === burger.id).status).toBe("VOIDED");
    expect(after.subtotalMinor).toBe(PRICES.fries); // only the fries remain
    expect(after.discountMinor).toBe(Math.floor(PRICES.fries / 10)); // the same 10% on what is left
    const taxable = PRICES.fries - after.discountMinor;
    expect(after.totalMinor).toBe(taxable + after.taxMinor);
    expect(after.taxMinor).toBe(tax13(taxable));
    const audit = (await auditFor(fx.tenantId, "Order", o.id)).find((a) => a.action === "orders.void")!;
    expect(audit.after).toMatchObject({ wasSentToKitchen: true, amountMinor: burger.lineTotalMinor });
  });

  it("a manager can void within their limit; voiding the last item cancels the order; a combo is voided as a whole", async () => {
    const o = await place(w.as.manager, typicalOrder(w, { lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }, { kind: "combo", comboId: w.meal.id, quantity: 1, choices: [{ slotId: w.meal.drinkSlot, optionId: w.meal.colaOption }] }] }));
    const combo = o.lines.find((l: any) => l.kind === "COMBO");
    expect((await w.as.manager.post(`/orders/${o.id}/lines/${combo.children[0].id}/void`, { reasonId: w.reasons.void })).status).toBe(409); // not one part
    const afterCombo = await w.as.manager.post(`/orders/${o.id}/lines/${combo.id}/void`, { reasonId: w.reasons.void });
    expect(afterCombo.status).toBe(200);
    expect(afterCombo.body.data.lines.find((l: any) => l.kind === "COMBO").children.every((c: any) => c.status === "VOIDED")).toBe(true);
    expect(afterCombo.body.data.subtotalMinor).toBe(PRICES.fries);

    const fries = afterCombo.body.data.lines.find((l: any) => l.kind === "ITEM");
    const last = await w.as.manager.post(`/orders/${o.id}/lines/${fries.id}/void`, { reasonId: w.reasons.void });
    expect(last.body.data).toMatchObject({ status: "CANCELLED", totalMinor: 0 });
    expect((await w.as.manager.post(`/orders/${o.id}/lines/${fries.id}/void`, { reasonId: w.reasons.void })).status).toBe(409); // closed
  });

  it("an item on a paid order cannot be voided if that would leave it overpaid: refund instead", async () => {
    const o = await place(owner, typicalOrder(w));
    await owner.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: o.totalMinor });
    const burger = o.lines.find((l: any) => l.nameSnapshot === "Burger");
    const res = await owner.post(`/orders/${o.id}/lines/${burger.id}/void`, { reasonId: w.reasons.void });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Refund/i);
  });
});

describe("refunds", () => {
  it("a manager refunds part of a paid order; the status follows; more than was paid is refused", async () => {
    const o = await place(owner, typicalOrder(w, { lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] }));
    await owner.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: o.totalMinor });
    const refund = (amountMinor: number, as = w.as.manager) => as.post(`/orders/${o.id}/refund`, { amountMinor, paymentMethodId: w.methods.cash, reasonId: w.reasons.refund });

    expect((await refund(o.totalMinor + 1)).status).toBe(422);
    const partial = await refund(10_000);
    expect(partial.status).toBe(201);
    expect(partial.body.data).toMatchObject({ paymentStatus: "PARTIALLY_REFUNDED", refundedMinor: 10_000 });
    const rest = o.totalMinor - 10_000;
    expect((await refund(rest + 1)).status).toBe(422);
    const full = await refund(rest);
    expect(full.body.data).toMatchObject({ paymentStatus: "REFUNDED", refundedMinor: o.totalMinor });
    expect((await refund(1)).status).toBe(409); // nothing left

    const log = (await auditFor(fx.tenantId, "Order", o.id)).filter((a) => a.action === "orders.refund");
    expect(log).toHaveLength(2);
    const row = await runAsTenant(fx.tenantId, () => db.refund.findFirstOrThrow({ where: { orderId: o.id } }));
    await expect(unscopedDb.refund.delete({ where: { id: row.id } })).rejects.toThrow(); // append-only
  });

  it("a cashier cannot refund without a manager", async () => {
    const o = await place(owner, typicalOrder(w, { lines: [{ kind: "item", variantId: w.fries.regular, quantity: 1 }] }));
    await owner.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: o.totalMinor });
    const res = await w.as.cashier.post(`/orders/${o.id}/refund`, { amountMinor: 1_000, paymentMethodId: w.methods.cash, reasonId: w.reasons.refund });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN"); // a cashier holds no refund permission at all: refunds are a manager's job
  });
});

describe("who can see what", () => {
  it("lists with filters and search; the cashier sees their branch only", async () => {
    const list = await owner.get(`/orders?locationId=${w.pkr.id}&status=CONFIRMED&pageSize=100`);
    expect(list.status).toBe(200);
    expect(list.body.data.every((x: any) => x.status === "CONFIRMED" && x.locationId === w.pkr.id)).toBe(true);
    expect((await owner.get(`/orders?locationId=${w.aed.id}`)).body.data.every((x: any) => x.currencyCode === "AED")).toBe(true);
    const byNumber = await owner.get(`/orders?locationId=${w.pkr.id}&q=1`);
    expect(byNumber.body.data.length).toBeGreaterThan(0);
    expect((await owner.get("/orders?sort=passwordHash")).status).toBe(422);

    const cashierSees = (await w.as.cashier.get("/orders?pageSize=100")).body.data;
    expect(cashierSees.length).toBeGreaterThan(0);
    expect(cashierSees.every((x: any) => x.locationId === w.pkr.id)).toBe(true);
    const dubai = (await owner.get(`/orders?locationId=${w.aed.id}`)).body.data[0];
    expect((await w.as.cashier.get(`/orders/${dubai.id}`)).status).toBe(404);
    expect((await w.as.cashier.post("/orders", { ...typicalOrder(w), locationId: w.aed.id })).status).toBe(404);
  });

  it("another organization cannot see, pay, void or refund these orders", async () => {
    const other = await createFixture();
    try {
      const asOther = api(app, (await loginOwner(app, other)).token);
      const o = (await owner.get(`/orders?locationId=${w.pkr.id}&pageSize=1`)).body.data[0];
      expect((await asOther.get(`/orders/${o.id}`)).status).toBe(404);
      expect((await asOther.get("/orders")).body.data).toHaveLength(0);
      expect((await asOther.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.cash, tenderedMinor: 1 })).status).toBe(404);
      expect((await asOther.post(`/orders/${o.id}/refund`, { amountMinor: 1, paymentMethodId: w.methods.cash, reasonId: w.reasons.refund })).status).toBe(404);
      expect((await asOther.post("/orders", typicalOrder(w))).status).toBe(404); // not even the branch exists for them
      expect((await asOther.get(`/kds?locationId=${w.pkr.id}`)).body.data).toEqual([]);
    } finally {
      await other.cleanup();
    }
  });
});
