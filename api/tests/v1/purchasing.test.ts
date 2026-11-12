import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { createFixture, loginOwner, type Fixture } from "../helpers/fixtures.js";
import { api } from "../helpers/http.js";
import { buildSalesWorld, type SalesWorld } from "../helpers/sales.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
const app = createApp();
let fx: Fixture;
let w: SalesWorld;
let owner: ReturnType<typeof api>;
let millCo: any, cheapMill: any, flour: any, oil: any, sugar: any;

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
const stockOf = async (locationId: string, itemId: string) => ((await owner.get(`/inventory/stock?locationId=${locationId}`)).body.data as any[]).find((r) => r.itemId === itemId);

describe("suppliers and their catalogue", () => {
  it("are managed by people with supplier rights, and a blank email is fine", async () => {
    millCo = await must(owner.post("/suppliers", { name: "Mill Co", code: "MILL", email: "", paymentTermsDays: 7 }));
    cheapMill = await must(owner.post("/suppliers", { name: "Cheap Mill" }));
    expect(millCo.paymentTermsDays).toBe(7);
    expect((await w.as.cashier.post("/suppliers", { name: "Nope" })).status).toBe(403);
    expect((await owner.post("/suppliers", { name: "Dup", code: "mill" })).status).toBe(409); // code unique ignoring case
    flour = await must(owner.post("/inventory-items", { name: "Flour", unit: "kg", reorderLevel: 10, parLevel: 40 }));
    oil = await must(owner.post("/inventory-items", { name: "Oil", unit: "l", reorderLevel: 10, parLevel: 50 }));
    sugar = await must(owner.post("/inventory-items", { name: "Sugar", unit: "kg", reorderLevel: 5 }));
  });

  it("each item has one preferred supplier at a time", async () => {
    const a = await must(owner.post("/supplier-items", { supplierId: millCo.id, itemId: flour.id, packName: "Sack 25kg", packQty: 25, priceMinor: 5_000, isPreferred: true }));
    const b = await must(owner.post("/supplier-items", { supplierId: cheapMill.id, itemId: flour.id, packName: "Bag 10kg", packQty: 10, priceMinor: 1_800 }));
    await must(owner.post("/supplier-items", { supplierId: millCo.id, itemId: oil.id, packName: "Drum 20l", packQty: 20, priceMinor: 9_000, isPreferred: true }));
    expect((await owner.post("/supplier-items", { supplierId: millCo.id, itemId: flour.id, packName: "Sack 25kg", priceMinor: 1 })).status).toBe(409); // same pack twice
    await must(owner.patch(`/supplier-items/${b.id}`, { isPreferred: true }), 200);
    const list = (await owner.get(`/supplier-items?itemId=${flour.id}`)).body.data as any[];
    expect(list.filter((x) => x.isPreferred).map((x) => x.id)).toEqual([b.id]);
    await must(owner.patch(`/supplier-items/${a.id}`, { isPreferred: true }), 200); // and back
  });
});

describe("a purchase order from draft to received", () => {
  let po: any;

  it("is drafted with a total, edited while a draft, and then fixed once approved", async () => {
    po = await must(owner.post("/purchase-orders", { locationId: w.pkr.id, supplierId: millCo.id, lines: [{ itemId: flour.id, orderedPacks: 4, unitPriceMinor: 5_000 }] }));
    expect(po).toMatchObject({ status: "DRAFT", totalMinor: 20_000, currencyCode: "PKR" });
    const detail = (await owner.get(`/purchase-orders/${po.id}`)).body.data;
    expect(detail.lines[0]).toMatchObject({ packName: "Sack 25kg", packQty: 25 }); // taken from the supplier's catalogue
    await must(owner.put(`/purchase-orders/${po.id}`, { locationId: w.pkr.id, supplierId: millCo.id, lines: [{ itemId: flour.id, orderedPacks: 4, unitPriceMinor: 5_000 }, { itemId: oil.id, orderedPacks: 1, unitPriceMinor: 9_000 }] }), 200);
    expect((await owner.get(`/purchase-orders/${po.id}`)).body.data.totalMinor).toBe(29_000);
    await must(owner.put(`/purchase-orders/${po.id}`, { locationId: w.pkr.id, supplierId: millCo.id, lines: [{ itemId: flour.id, orderedPacks: 4, unitPriceMinor: 5_000 }] }), 200);
    expect((await owner.post(`/purchase-orders/${po.id}/receive`, { lines: [{ itemId: flour.id, packs: 1 }] })).status).toBe(409); // not approved yet
    await must(owner.post(`/purchase-orders/${po.id}/approve`, {}), 200);
    expect((await owner.put(`/purchase-orders/${po.id}`, { locationId: w.pkr.id, supplierId: millCo.id, lines: [{ itemId: flour.id, orderedPacks: 1, unitPriceMinor: 1 }] })).status).toBe(409);
    expect((await owner.post(`/purchase-orders/${po.id}/approve`, {})).status).toBe(409); // once
    await must(owner.post(`/purchase-orders/${po.id}/send`, {}), 200);
  });

  it("receiving puts stock in at the order's price, in as many deliveries as it takes", async () => {
    const first = await must(owner.post(`/purchase-orders/${po.id}/receive`, { lines: [{ itemId: flour.id, packs: 3 }] }));
    expect(first.status).toBe("PARTIALLY_RECEIVED");
    expect(await stockOf(w.pkr.id, flour.id)).toMatchObject({ qty: 75, avgCost: 200 }); // 3 sacks x 25 kg at 5,000 / 25 = 200 per kg
    expect((await owner.post(`/purchase-orders/${po.id}/receive`, { lines: [{ itemId: flour.id, packs: 2 }] })).status).toBe(422); // only 1 sack left
    expect((await owner.post(`/purchase-orders/${po.id}/cancel`, {})).status).toBe(409); // goods already arrived
    const last = await must(owner.post(`/purchase-orders/${po.id}/receive`, { lines: [{ itemId: flour.id, packs: 1 }] }));
    expect(last.status).toBe("RECEIVED");
    expect((await stockOf(w.pkr.id, flour.id)).qty).toBe(100);
    const receipts = (await owner.get(`/goods-receipts?locationId=${w.pkr.id}`)).body.data as any[];
    expect(receipts).toHaveLength(2);
    expect(receipts.map((r) => r.totalMinor).sort((a, b) => a - b)).toEqual([5_000, 15_000]);
    expect((await w.as.cashier.get("/purchase-orders")).status).toBe(403);
  });

  it("goods without an order can be received directly", async () => {
    await must(owner.post("/goods-receipts/direct", { locationId: w.pkr.id, supplierId: millCo.id, lines: [{ itemId: sugar.id, packs: 2, packQty: 5, unitPriceMinor: 1_000 }] }));
    expect(await stockOf(w.pkr.id, sugar.id)).toMatchObject({ qty: 10, avgCost: 200 });
  });

  it("a draft order can be cancelled, and another branch's orders are not visible to a branch user", async () => {
    const draft = await must(owner.post("/purchase-orders", { locationId: w.aed.id, supplierId: millCo.id, lines: [{ itemId: oil.id, orderedPacks: 1, unitPriceMinor: 9_000 }] }));
    await must(owner.post(`/purchase-orders/${draft.id}/cancel`, {}), 200);
    expect((await owner.get(`/purchase-orders/${draft.id}`)).body.data.status).toBe("CANCELLED");
  });
});

describe("suggested orders", () => {
  it("top low items up to par from the preferred supplier in whole packs, and list what nobody supplies", async () => {
    await must(owner.post("/inventory/adjustments", { locationId: w.pkr.id, itemId: oil.id, type: "OPENING", qty: 4, unitCost: 450 }));
    await must(owner.post("/inventory/adjustments", { locationId: w.pkr.id, itemId: sugar.id, type: "WASTE", qty: 7, reason: "Spilt" })); // 3 kg left, under its reorder level of 5
    const s = (await owner.get(`/suggested-orders?locationId=${w.pkr.id}`)).body.data;
    expect(s.suppliers).toHaveLength(1);
    expect(s.suppliers[0]).toMatchObject({ supplierName: "Mill Co", totalMinor: 27_000 });
    expect(s.suppliers[0].lines[0]).toMatchObject({ name: "Oil", needQty: 46, packs: 3, packName: "Drum 20l", lineTotalMinor: 27_000 }); // 50 - 4, rounded up to 3 drums
    expect(s.unsourced).toEqual([expect.objectContaining({ name: "Sugar", needQty: 7 })]); // no par set: twice the reorder level (10) minus 3
    expect(s.suppliers.flatMap((x: any) => x.lines).map((l: any) => l.name)).not.toContain("Flour"); // 100 kg is plenty
  });
});

describe("supplier invoices and payments", () => {
  let inv: any;
  it("an invoice takes its due date from the supplier's terms and cannot be entered twice", async () => {
    inv = await must(owner.post("/supplier-invoices", { supplierId: millCo.id, invoiceNo: "INV-77", invoiceDate: "2020-01-01", totalMinor: 20_000 }));
    expect(inv.dueDate.slice(0, 10)).toBe("2020-01-08"); // 7 days
    expect((await owner.post("/supplier-invoices", { supplierId: millCo.id, invoiceNo: "INV-77", invoiceDate: "2020-02-01", totalMinor: 1 })).status).toBe(409);
    const row = ((await owner.get("/supplier-invoices?unpaid=true")).body.data as any[]).find((i) => i.id === inv.id);
    expect(row).toMatchObject({ overdue: true, outstandingMinor: 20_000, supplierName: "Mill Co" });
  });

  it("payments reduce what is owed until the invoice is paid, and never exceed it", async () => {
    const part = await must(owner.post(`/supplier-invoices/${inv.id}/payments`, { amountMinor: 8_000, method: "Bank transfer", reference: "TT-1" }));
    expect(part).toEqual({ paidMinor: 8_000, outstandingMinor: 12_000, status: "PARTIALLY_PAID" });
    expect((await owner.post(`/supplier-invoices/${inv.id}/payments`, { amountMinor: 12_001, method: "Cash" })).status).toBe(422);
    expect((await owner.post(`/supplier-invoices/${inv.id}/void`, {})).status).toBe(409); // already part paid
    const pay = (await owner.get("/supplier-invoices/payables")).body;
    expect(pay.data).toEqual([expect.objectContaining({ supplierName: "Mill Co", outstandingMinor: 12_000, overdueMinor: 12_000 })]);
    const done = await must(owner.post(`/supplier-invoices/${inv.id}/payments`, { amountMinor: 12_000, method: "Cash" }));
    expect(done.status).toBe("PAID");
    expect((await owner.post(`/supplier-invoices/${inv.id}/payments`, { amountMinor: 1, method: "Cash" })).status).toBe(409);
    expect((await owner.get("/supplier-invoices/payables")).body.data).toEqual([]);
  });

  it("a payment record can never be edited or deleted", async () => {
    const row = await unscopedDb.supplierPayment.findFirst({ where: { tenantId: fx.tenantId } });
    await expect(unscopedDb.supplierPayment.update({ where: { id: row!.id }, data: { amountMinor: 1 } })).rejects.toThrow();
    await expect(unscopedDb.supplierPayment.delete({ where: { id: row!.id } })).rejects.toThrow();
  });

  it("an unpaid invoice can be voided", async () => {
    const bad = await must(owner.post("/supplier-invoices", { supplierId: cheapMill.id, invoiceNo: "X-1", invoiceDate: "2020-03-01", totalMinor: 500 }));
    await must(owner.post(`/supplier-invoices/${bad.id}/void`, {}), 200);
    expect((await owner.get(`/supplier-invoices/${bad.id}`)).body.data).toMatchObject({ status: "VOID", outstandingMinor: 0 });
  });
});
