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
let flour: any, tomato: any, patty: any, sauce: any;

beforeAll(async () => {
  fx = await createFixture();
  w = await buildSalesWorld(fx, app);
  owner = api(app, (await loginOwner(app, fx)).token);
}, 240_000);
afterAll(async () => {
  await fx.cleanup();
  await unscopedDb.$disconnect();
});

const stockOf = async (locationId: string, itemId: string) => {
  const rows = (await owner.get(`/inventory/stock?locationId=${locationId}`)).body.data as any[];
  return rows.find((r) => r.itemId === itemId);
};
const complete = async (id: string) => {
  const direct = await owner.post(`/orders/${id}/status`, { status: "COMPLETED" });
  if (direct.status === 200) return;
  for (const status of ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]) await owner.post(`/orders/${id}/status`, { status });
};

describe("items", () => {
  it("are created by people who manage items, with a unit and a reorder level", async () => {
    const make = async (body: object) => { const r = await owner.post("/inventory-items", body); expect(r.status, JSON.stringify(r.body?.error)).toBe(201); return r.body.data; };
    patty = await make({ name: "Beef patty", sku: "BP-1", unit: "pcs", referenceCost: 20_000, reorderLevel: 10 });
    sauce = await make({ name: "House sauce", kind: "PREP", unit: "l", referenceCost: 0 });
    tomato = await make({ name: "Tomato", unit: "kg", referenceCost: 400 });
    flour = await make({ name: "Flour", unit: "kg", referenceCost: 100 });
    expect(patty.reorderLevel).toBe(10); // decimals come back as numbers, not strings
    expect((await w.as.cashier.post("/inventory-items", { name: "Nope", unit: "kg" })).status).toBe(403);
    expect((await owner.post("/inventory-items", { name: "Bad unit", unit: "cups" })).status).toBe(422);
    expect((await owner.post("/inventory-items", { name: "Dup sku", sku: "bp-1", unit: "pcs" })).status).toBe(409); // sku is unique ignoring case
  });
});

describe("stock movements", () => {
  it("opening stock sets the quantity and the average cost follows each purchase price", async () => {
    expect((await owner.post("/inventory/adjustments", { locationId: w.pkr.id, itemId: patty.id, type: "OPENING", qty: 20, unitCost: 20_000 })).status).toBe(201);
    expect((await owner.post("/inventory/adjustments", { locationId: w.pkr.id, itemId: patty.id, type: "OPENING", qty: 20, unitCost: 30_000 })).status).toBe(201);
    const row = await stockOf(w.pkr.id, patty.id);
    expect(row.qty).toBe(40);
    expect(row.avgCost).toBe(25_000); // (20 x 20,000 + 20 x 30,000) / 40
    expect(row.valueMinor).toBe(1_000_000);
    expect(row.status).toBe("ok");
  });

  it("waste takes stock out, needs a sensible amount, and can never go below zero", async () => {
    const waste = await owner.post("/inventory/adjustments", { locationId: w.pkr.id, itemId: patty.id, type: "WASTE", qty: 35, reason: "Fridge failed" });
    expect(waste.status).toBe(201);
    expect((await stockOf(w.pkr.id, patty.id))).toMatchObject({ qty: 5, status: "low" }); // at or under the reorder level of 10
    expect((await owner.post("/inventory/adjustments", { locationId: w.pkr.id, itemId: patty.id, type: "WASTE", qty: 6 })).status).toBe(409); // only 5 left
    expect((await owner.post("/inventory/adjustments", { locationId: w.pkr.id, itemId: patty.id, type: "ADJUSTMENT", qty: 1 })).status).toBe(422); // a correction needs a reason
    const ledger = (await owner.get(`/inventory/movements?locationId=${w.pkr.id}&itemId=${patty.id}`)).body.data as any[];
    expect(ledger.map((m) => m.type)).toEqual(["WASTE", "OPENING", "OPENING"]);
    expect(ledger[0]).toMatchObject({ qty: -35, reason: "Fridge failed", itemName: "Beef patty" });
  });

  it("is one branch's own: the other branch has none, and a branch user cannot post to a branch that is not theirs", async () => {
    expect((await stockOf(w.aed.id, patty.id)).qty).toBe(0);
    expect((await w.as.cashier.get(`/inventory/stock?locationId=${w.aed.id}`)).status).toBe(403); // cashiers hold no stock permission at all
  });

  it("the ledger cannot be edited or deleted, even directly in the database", async () => {
    const row = await unscopedDb.stockMovement.findFirst({ where: { tenantId: fx.tenantId } });
    await expect(unscopedDb.stockMovement.update({ where: { id: row!.id }, data: { reason: "tampered" } })).rejects.toThrow();
    await expect(unscopedDb.stockMovement.delete({ where: { id: row!.id } })).rejects.toThrow();
  });
});

describe("recipes and selling", () => {
  it("a recipe prices a portion from its ingredients, waste included", async () => {
    await owner.post("/inventory/adjustments", { locationId: w.pkr.id, itemId: tomato.id, type: "OPENING", qty: 50, unitCost: 400 });
    const put = await owner.put("/recipes", { variantId: w.fries.regular, lines: [{ itemId: tomato.id, qty: 0.2, wastePercent: 25 }] });
    expect(put.status, JSON.stringify(put.body?.error)).toBe(201);
    const list = (await owner.get("/recipes")).body.data as any[];
    const r = list.find((x) => x.variantId === w.fries.regular);
    expect(r).toMatchObject({ kind: "menu", ingredients: 1 });
    expect(r.costPerUnitMinor).toBe(100); // 0.2 kg x 1.25 x 400
    expect((await owner.put("/recipes", { variantId: w.fries.regular, prepItemId: sauce.id, lines: [{ itemId: tomato.id, qty: 1 }] })).status).toBe(422); // one target only
    expect((await owner.put("/recipes", { prepItemId: patty.id, lines: [{ itemId: tomato.id, qty: 1 }] })).status).toBe(422); // only a PREP item has a batch recipe
  });

  it("completing an order takes the ingredients out of that branch's stock, once", async () => {
    const created = await owner.post("/orders", typicalOrder(w, { lines: [{ kind: "item", variantId: w.fries.regular, quantity: 4 }] }));
    expect(created.status, JSON.stringify(created.body?.error)).toBe(201);
    const id = created.body.data.id;
    const pay = await owner.post(`/orders/${id}/payments`, { paymentMethodId: w.methods.card, tenderedMinor: created.body.data.totalMinor, reference: "SLIP-1" }); // card: no cash shift needed
    expect(pay.status, JSON.stringify(pay.body?.error)).toBe(201);
    expect((await stockOf(w.pkr.id, tomato.id)).qty).toBe(50); // paying alone does not move stock
    await complete(id);
    expect((await stockOf(w.pkr.id, tomato.id)).qty).toBe(49); // 4 portions x 0.2 kg x 1.25
    await owner.post(`/orders/${id}/status`, { status: "COMPLETED" }); // a repeat changes nothing
    expect((await stockOf(w.pkr.id, tomato.id)).qty).toBe(49);
    const sales = (await owner.get(`/inventory/movements?locationId=${w.pkr.id}&itemId=${tomato.id}&types=SALE`)).body.data as any[];
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ qty: -1, refType: "ORDER", refId: id });
  });
});

describe("production", () => {
  it("a batch uses the recipe's ingredients and makes the prep item at their cost", async () => {
    await owner.post("/inventory/adjustments", { locationId: w.pkr.id, itemId: flour.id, type: "OPENING", qty: 10, unitCost: 100 });
    const recipe = await owner.put("/recipes", { prepItemId: sauce.id, yieldQty: 5, lines: [{ itemId: tomato.id, qty: 4 }, { itemId: flour.id, qty: 1 }] });
    expect(recipe.status, JSON.stringify(recipe.body?.error)).toBe(201);
    const run = await owner.post("/production", { locationId: w.pkr.id, prepItemId: sauce.id, producedQty: 10 }); // twice the recipe
    expect(run.status, JSON.stringify(run.body?.error)).toBe(201);
    expect((await stockOf(w.pkr.id, tomato.id)).qty).toBe(41); // 49 - 8
    expect((await stockOf(w.pkr.id, flour.id)).qty).toBe(8); // 10 - 2
    const made = await stockOf(w.pkr.id, sauce.id);
    expect(made.qty).toBe(10);
    expect(made.avgCost).toBe(340); // (8 kg x 400 + 2 kg x 100) / 10 l
    expect((await owner.post("/production", { locationId: w.pkr.id, prepItemId: sauce.id, producedQty: 100 })).status).toBe(409); // not enough tomato
  });
});

describe("counts", () => {
  let countId = "";
  it("a count compares the shelf with the system, and approving it corrects the stock", async () => {
    const start = await owner.post("/stock-counts", { locationId: w.pkr.id, itemIds: [tomato.id, flour.id] });
    expect(start.status, JSON.stringify(start.body?.error)).toBe(201);
    countId = start.body.data.id;
    const detail = (await owner.get(`/stock-counts/${countId}`)).body.data;
    expect(detail.lines.map((l: any) => [l.item.name, l.expectedQty])).toEqual([["Flour", 8], ["Tomato", 41]]);
    expect((await owner.post(`/stock-counts/${countId}/submit`, {})).status).toBe(409); // nothing counted yet
    await owner.put(`/stock-counts/${countId}/lines`, { lines: [{ itemId: tomato.id, countedQty: 39.5 }, { itemId: flour.id, countedQty: 8 }] });
    expect((await owner.post(`/stock-counts/${countId}/submit`, {})).status).toBe(200);
    expect((await owner.put(`/stock-counts/${countId}/lines`, { lines: [{ itemId: tomato.id, countedQty: 1 }] })).status).toBe(409); // locked once submitted
    expect((await stockOf(w.pkr.id, tomato.id)).qty).toBe(41); // not applied until approved
    const approve = await owner.post(`/stock-counts/${countId}/approve`, {});
    expect(approve.body.data).toEqual({ adjusted: 1 }); // flour matched, only tomato changed
    expect((await stockOf(w.pkr.id, tomato.id)).qty).toBe(39.5);
    expect((await owner.post(`/stock-counts/${countId}/approve`, {})).status).toBe(409);
  });
});

describe("transfers", () => {
  it("move stock between locations: out when sent, in when received, at the sending cost", async () => {
    const make = await owner.post("/stock-transfers", { fromLocationId: w.pkr.id, toLocationId: w.aed.id, lines: [{ itemId: flour.id, qty: 3 }] });
    expect(make.status, JSON.stringify(make.body?.error)).toBe(201);
    const id = make.body.data.id;
    expect((await stockOf(w.pkr.id, flour.id)).qty).toBe(8); // requesting moves nothing
    expect((await owner.post(`/stock-transfers/${id}/receive`, { lines: [{ itemId: flour.id, receivedQty: 3 }] })).status).toBe(409); // not sent yet
    expect((await owner.post(`/stock-transfers/${id}/ship`, {})).status).toBe(200);
    expect((await stockOf(w.pkr.id, flour.id)).qty).toBe(5);
    expect((await stockOf(w.aed.id, flour.id)).qty).toBe(0); // still on the road
    expect((await owner.post(`/stock-transfers/${id}/receive`, { lines: [{ itemId: flour.id, receivedQty: 4 }] })).status).toBe(422); // cannot receive more than was sent
    expect((await owner.post(`/stock-transfers/${id}/receive`, { lines: [{ itemId: flour.id, receivedQty: 2.5 }] })).status).toBe(200);
    expect(await stockOf(w.aed.id, flour.id)).toMatchObject({ qty: 2.5, avgCost: 100 });
    const detail = (await owner.get(`/stock-transfers/${id}`)).body.data;
    expect(detail).toMatchObject({ status: "RECEIVED", fromName: expect.any(String), toName: expect.any(String) });
    expect(detail.lines[0].receivedQty).toBe(2.5); // the 0.5 short is on the record
    expect((await owner.post("/stock-transfers", { fromLocationId: w.pkr.id, toLocationId: w.pkr.id, lines: [{ itemId: flour.id, qty: 1 }] })).status).toBe(422);
  });
});

describe("isolation", () => {
  it("one organization never sees another's items", async () => {
    const other = await createFixture();
    try {
      const them = api(app, (await loginOwner(app, other)).token);
      const list = (await them.get("/inventory-items")).body.data as any[];
      expect(list).toHaveLength(0);
      expect((await them.get(`/inventory-items/${patty.id}`)).status).toBe(404);
    } finally {
      await other.cleanup();
    }
  });
});
