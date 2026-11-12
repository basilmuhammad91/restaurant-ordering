import { businessDateOf } from "@restoflux/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { createFixture, loginOwner, type Fixture } from "../helpers/fixtures.js";
import { api } from "../helpers/http.js";
import { buildSalesWorld, typicalOrder, type SalesWorld } from "../helpers/sales.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
const app = createApp();
let fx: Fixture;
let w: SalesWorld;
let owner: ReturnType<typeof api>;
let tomato: any, supplier: any;
const dayAt = (n: number) => businessDateOf(new Date(Date.now() + n * 86_400_000), "Asia/Karachi", "05:00");
const range = () => `from=${dayAt(-1)}&to=${dayAt(1)}&currencyCode=PKR&locationIds=${w.pkr.id}`;

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
const sellFries = async (quantity: number) => {
  const o = await must(owner.post("/orders", typicalOrder(w, { lines: [{ kind: "item", variantId: w.fries.regular, quantity }] })));
  await must(owner.post(`/orders/${o.id}/payments`, { paymentMethodId: w.methods.card, tenderedMinor: o.totalMinor, reference: "R1" }));
  for (const status of ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]) { const r = await owner.post(`/orders/${o.id}/status`, { status }); if (status === "COMPLETED") expect(r.status, JSON.stringify(r.body?.error)).toBe(200); }
  return o;
};

describe("menu and food cost reports", () => {
  it("set up: stock, a recipe for fries, and five portions sold", async () => {
    tomato = await must(owner.post("/inventory-items", { name: "Tomato", unit: "kg", referenceCost: 400, category: "Produce" }));
    await must(owner.post("/inventory/adjustments", { locationId: w.pkr.id, itemId: tomato.id, type: "OPENING", qty: 50, unitCost: 400 }));
    await must(owner.put("/recipes", { variantId: w.fries.regular, lines: [{ itemId: tomato.id, qty: 0.25 }] }));
    await sellFries(3);
    await sellFries(2);
  });

  it("menu performance shows each item's sales, cost and margin, and places it on the menu-engineering grid", async () => {
    const r = (await owner.get(`/reports/menu-performance?${range()}`)).body;
    const fries = r.data.find((x: any) => x.name.startsWith("Fries"));
    expect(fries).toMatchObject({ qty: 5, revenueMinor: 150_000, costMinor: 500, hasRecipe: true, unitCostMinor: 100, marginMinor: 149_500, group: "STAR" });
    expect(fries.costPct).toBeCloseTo(0.3, 1);
    expect(r.meta).toMatchObject({ currencyCode: "PKR", totalQty: 5, withoutRecipe: 0 });
    expect((await w.as.cashier.get(`/reports/menu-performance?${range()}`)).status).toBe(403);
  });

  it("food cost adds waste and counted losses to what the recipes say was used", async () => {
    await must(owner.post("/inventory/adjustments", { locationId: w.pkr.id, itemId: tomato.id, type: "WASTE", qty: 2, reason: "Spoiled" })); // 800
    const count = await must(owner.post("/stock-counts", { locationId: w.pkr.id, itemIds: [tomato.id] }));
    await must(owner.put(`/stock-counts/${count.id}/lines`, { lines: [{ itemId: tomato.id, countedQty: 45.75 }] }), 200); // 46.75 expected: 1 kg short = 400
    await must(owner.post(`/stock-counts/${count.id}/submit`, {}), 200);
    await must(owner.post(`/stock-counts/${count.id}/approve`, {}), 200);
    const f = (await owner.get(`/reports/food-cost?${range()}`)).body.data;
    expect(f).toMatchObject({ salesMinor: 150_000, soldQty: 5, recipeCoveragePct: 100, theoreticalCostMinor: 500, wasteMinor: 800, shrinkMinor: 400, actualCostMinor: 1_700, grossProfitMinor: 148_300 });
    expect(f.actualPct).toBeCloseTo(1.1, 1);
    expect(f.wasteByType.find((x: any) => x.type === "WASTE").valueMinor).toBe(800);
    expect(f.topWasted[0]).toMatchObject({ name: "Tomato", qty: 2, valueMinor: 800 });
    expect(f.byDay).toHaveLength(1);
  });

  it("a branch in another currency is never mixed in", async () => {
    const aed = (await owner.get(`/reports/food-cost?from=${dayAt(-1)}&to=${dayAt(1)}&currencyCode=AED`)).body.data;
    expect(aed).toMatchObject({ currencyCode: "AED", salesMinor: 0, soldQty: 0 });
  });
});

describe("inventory report", () => {
  it("values stock on hand and summarises what moved", async () => {
    const r = (await owner.get(`/reports/inventory?${range()}`)).body.data;
    expect(r.totalValueMinor).toBe(18_300); // 45.75 kg at 400
    expect(r.byLocation).toEqual([expect.objectContaining({ valueMinor: 18_300, items: 1 })]);
    expect(r.byCategory).toEqual([{ category: "Produce", valueMinor: 18_300 }]);
    expect(r.movement.map((m: any) => m.type).sort()).toEqual(["COUNT", "OPENING", "SALE", "SALE", "WASTE"].filter((t, i, a) => a.indexOf(t) === i).sort());
    expect(r.topUsage[0]).toMatchObject({ name: "Tomato", qty: 1.25, valueMinor: 500 });
  });
});

describe("purchasing reports", () => {
  it("spend by supplier and item, payables ageing, and a supplier's ledger", async () => {
    supplier = await must(owner.post("/suppliers", { name: "Green Farms", paymentTermsDays: 0 }));
    await must(owner.post("/goods-receipts/direct", { locationId: w.pkr.id, supplierId: supplier.id, lines: [{ itemId: tomato.id, packs: 2, packQty: 5, unitPriceMinor: 2_000 }] }));
    const inv = await must(owner.post("/supplier-invoices", { supplierId: supplier.id, invoiceNo: "G-1", invoiceDate: "2020-01-01", totalMinor: 10_000 }));
    await must(owner.post(`/supplier-invoices/${inv.id}/payments`, { amountMinor: 4_000, method: "Cash" }));

    const p = (await owner.get(`/reports/purchasing?${range()}`)).body.data;
    expect(p.spendMinor).toBe(4_000);
    expect(p.bySupplier).toEqual([{ supplierId: supplier.id, name: "Green Farms", receipts: 1, spendMinor: 4_000 }]);
    expect(p.topItems[0]).toMatchObject({ name: "Tomato", qty: 10, spendMinor: 4_000, avgCostMinor: 400 });
    expect(p.aging).toEqual({ current: 0, d1_30: 0, d31_60: 0, d60plus: 6_000 });
    expect(p.outstandingMinor).toBe(6_000);
    expect(p.paidMinor).toBe(4_000);

    const ledger = (await owner.get(`/reports/supplier-ledger?supplierId=${supplier.id}&from=2020-01-01&to=${dayAt(1)}`)).body.data;
    expect(ledger.openingMinor).toBe(0);
    expect(ledger.entries.map((e: any) => [e.type, e.debitMinor, e.creditMinor, e.balanceMinor])).toEqual([["invoice", 10_000, 0, 10_000], ["payment", 0, 4_000, 6_000]]);
    expect(ledger.closingMinor).toBe(6_000);
    const later = (await owner.get(`/reports/supplier-ledger?supplierId=${supplier.id}&from=2021-01-01&to=${dayAt(1)}`)).body.data;
    expect(later.openingMinor).toBe(10_000); // the 2020 invoice before the period becomes the opening balance
    expect(later.entries.map((e: any) => [e.type, e.balanceMinor])).toEqual([["payment", 6_000]]); // today's payment is inside the period
  });
});

describe("fraud watch", () => {
  it("counts voids per person and only flags people far above their colleagues", async () => {
    const o = await must(owner.post("/orders", typicalOrder(w)));
    const burger = (await owner.get(`/orders/${o.id}`)).body.data.lines.find((l: any) => l.nameSnapshot.startsWith("Burger"));
    await must(w.as.manager.post(`/orders/${o.id}/lines/${burger.id}/void`, { reasonId: w.reasons.void }), 200);
    const r = (await owner.get(`/reports/fraud?${range()}`)).body;
    const mgr = r.data.find((x: any) => x.userId === w.manager.id);
    expect(mgr).toMatchObject({ voids: 1, flags: [] });
    expect(mgr.voidMinor).toBeGreaterThan(0);
    expect(r.meta.voidMinor).toBe(mgr.voidMinor);
    expect((await w.as.cashier.get(`/reports/fraud?${range()}`)).status).toBe(403);
  });
});

describe("dashboard insights", () => {
  it("compares with the previous period, shows the busiest hours, best sellers and what needs attention", async () => {
    const r = (await owner.get(`/dashboard/insights?${range()}`)).body.data;
    expect(r.currencyCode).toBe("PKR");
    expect(r.compare).toMatchObject({ orders: 3, previousOrders: 0, previousNetSalesMinor: 0 }); // two completed orders plus the one from the fraud test; nothing before
    expect(r.hours).toHaveLength(24);
    expect(r.hours.reduce((s: number, h: any) => s + h.orders, 0)).toBe(3);
    expect(r.topItems[0]).toMatchObject({ qty: 6, revenueMinor: 180_000 }); // the fraud test order still has its fries (the burger line was voided)
    expect(r.recentOrders).toHaveLength(3);
    expect(r.alerts).toMatchObject({ openShifts: 0, deliveriesWaiting: 0, approvals: 0 });
    expect(typeof r.alerts.lowStock).toBe("number");
    expect(r.branches).toEqual([expect.objectContaining({ orders: 3 })]);
    expect(r.weekdays.reduce((t: number, d: any) => t + d.orders, 0)).toBe(3);
    expect(r.categories[0].revenueMinor).toBe(180_000);
    expect(r.foodCost).toEqual({ pct: 0.3, coveragePct: 100 }); // 600 of cost on 180,000 of sales
    expect(r.ops.stockValueMinor).toBeGreaterThan(0);
    expect(r.ops.owedMinor).toBe(6_000); // the invoice from the purchasing test, part paid
    expect(r.ops.customers).toMatchObject({ total: expect.any(Number) });
    // a cashier sees counts of what they can act on, never the money
    const cashier = (await w.as.cashier.get(`/dashboard/insights?${range()}`)).body.data;
    expect(cashier.compare).toBeUndefined();
    expect(cashier.topItems).toBeUndefined();
    expect(cashier.alerts.approvals).toBeUndefined(); // no approvals.view
    expect(cashier.branches).toBeUndefined();
    expect(cashier.ops.stockValueMinor).toBeUndefined();
  });
});
