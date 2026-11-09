import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { signToken } from "../src/lib/jwt.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();
const stamp = Date.now();
const domain = "@deals.example.test";
let admin = "";
let customer = "";
let aId = 0; // price 1000
let bId = 0; // price 500
let soldOutId = 0;

const as = (token: string) => ({ Authorization: token });
const create = (body: object, token = admin) => request(app).post("/api/deals").set(as(token)).send(body);

beforeAll(async () => {
  const passwordHash = await bcrypt.hash("irrelevant-password", 4);
  const mk = (n: string, role: "ADMIN" | "CUSTOMER") =>
    prisma.user.create({ data: { email: `${n}-${stamp}${domain}`, name: n, passwordHash, role } });
  const [a, c] = await Promise.all([mk("admin", "ADMIN"), mk("cust", "CUSTOMER")]);
  admin = `Bearer ${signToken(a)}`;
  customer = `Bearer ${signToken(c)}`;

  const cat = await prisma.category.create({ data: { name: `deal-cat-${stamp}` } });
  const item = (name: string, priceCents: number, available = true) =>
    prisma.menuItem.create({ data: { name: `deal-${name}-${stamp}`, priceCents, available, categoryId: cat.id } });
  aId = (await item("a", 1000)).id;
  bId = (await item("b", 500)).id;
  soldOutId = (await item("sold-out", 800, false)).id;
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { user: { email: { endsWith: domain } } } });
  await prisma.deal.deleteMany({ where: { name: { startsWith: "deal-test-" } } });
  await prisma.menuItem.deleteMany({ where: { name: { startsWith: "deal-" } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: "deal-cat-" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
  await prisma.$disconnect();
});

describe("deals", () => {
  let dealId = 0;
  const base = () => ({
    name: `deal-test-main-${stamp}`,
    dealPriceCents: 2000,
    items: [
      { menuItemId: aId, quantity: 2 },
      { menuItemId: bId, quantity: 1 },
    ],
  });

  it("only admins can create deals", async () => {
    expect((await request(app).post("/api/deals").send(base())).status).toBe(401);
    expect((await create(base(), customer)).status).toBe(403);
    expect((await request(app).get("/api/deals/manage")).status).toBe(401);
    expect((await request(app).get("/api/deals/manage").set(as(customer))).status).toBe(403);
  });

  it("creates a deal and computes the original price from its parts", async () => {
    const res = await create(base());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ dealPriceCents: 2000, originalPriceCents: 2500, isActive: true, available: true });
    expect(res.body.data.items).toHaveLength(2);
    dealId = res.body.data.id;
  });

  it("validates input", async () => {
    const bad = (patch: object) => create({ ...base(), ...patch });
    expect((await bad({ dealPriceCents: 3000 })).status).toBe(422); // dearer than the parts
    expect((await bad({ items: [{ menuItemId: aId, quantity: 1 }, { menuItemId: aId, quantity: 1 }] })).status).toBe(422);
    expect((await bad({ items: [{ menuItemId: 999999999, quantity: 1 }] })).status).toBe(422);
    expect((await bad({ items: [] })).status).toBe(422);
    expect((await bad({ imageUrl: "javascript:alert(1)" })).status).toBe(422);
    expect((await bad({ startsAt: "2030-01-02T00:00:00Z", endsAt: "2030-01-01T00:00:00Z" })).status).toBe(422);
  });

  it("public list shows only active, in-window deals; admin list shows everything", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await create({ ...base(), name: `deal-test-off-${stamp}`, isActive: false });
    await create({ ...base(), name: `deal-test-expired-${stamp}`, endsAt: past });
    await create({ ...base(), name: `deal-test-future-${stamp}`, startsAt: future });

    const pub = await request(app).get("/api/deals");
    expect(pub.status).toBe(200);
    const publicNames: string[] = pub.body.data.map((d: { name: string }) => d.name);
    expect(publicNames).toContain(`deal-test-main-${stamp}`);
    expect(publicNames.filter((n) => n.startsWith("deal-test-"))).toEqual([`deal-test-main-${stamp}`]);

    const all = await request(app).get("/api/deals/manage").set(as(admin));
    const allNames: string[] = all.body.data.map((d: { name: string }) => d.name);
    expect(allNames.filter((n) => n.startsWith("deal-test-"))).toHaveLength(4);
  });

  it("customers can order a deal; the order stores a price snapshot", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(as(customer))
      .send({ deals: [{ dealId, quantity: 2 }], items: [{ menuItemId: aId, quantity: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.totalCents).toBe(2 * 2000 + 1000);
    expect(res.body.data.channel).toBe("WEB");
    expect(res.body.data.deals[0]).toMatchObject({ dealId, dealName: `deal-test-main-${stamp}`, quantity: 2, unitPriceCents: 2000 });
    const orderId = res.body.data.id;

    // Editing the deal later must not change the past order.
    const patch = await request(app).patch(`/api/deals/${dealId}`).set(as(admin)).send({ name: `deal-test-main-${stamp}`, dealPriceCents: 1500 });
    expect(patch.status).toBe(200);
    const again = await request(app).get(`/api/orders/${orderId}`).set(as(customer));
    expect(again.body.data.totalCents).toBe(5000);
    expect(again.body.data.deals[0].unitPriceCents).toBe(2000);
  });

  it("an order can contain only a deal, but not nothing", async () => {
    const dealOnly = await request(app).post("/api/orders").set(as(customer)).send({ deals: [{ dealId, quantity: 1 }] });
    expect(dealOnly.status).toBe(201);
    expect(dealOnly.body.data.totalCents).toBe(1500); // the new price
    expect((await request(app).post("/api/orders").set(as(customer)).send({})).status).toBe(422);
  });

  it("rejects inactive, unknown, and unavailable deals", async () => {
    const all = await request(app).get("/api/deals/manage").set(as(admin));
    const off = all.body.data.find((d: { name: string }) => d.name === `deal-test-off-${stamp}`);
    const order = (deals: unknown) => request(app).post("/api/orders").set(as(customer)).send({ deals });
    expect((await order([{ dealId: off.id, quantity: 1 }])).status).toBe(422);
    expect((await order([{ dealId: 999999999, quantity: 1 }])).status).toBe(422);

    const broken = await create({
      name: `deal-test-broken-${stamp}`,
      dealPriceCents: 700,
      items: [{ menuItemId: soldOutId, quantity: 1 }],
    });
    expect(broken.status).toBe(201);
    expect(broken.body.data.available).toBe(false);
    expect((await order([{ dealId: broken.body.data.id, quantity: 1 }])).status).toBe(422);
  });

  it("replacing items recalculates the original price; price can't exceed it", async () => {
    const ok = await request(app)
      .patch(`/api/deals/${dealId}`)
      .set(as(admin))
      .send({ items: [{ menuItemId: bId, quantity: 2 }], dealPriceCents: 900 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.originalPriceCents).toBe(1000);
    expect(ok.body.data.items).toHaveLength(1);
    const tooDear = await request(app).patch(`/api/deals/${dealId}`).set(as(admin)).send({ dealPriceCents: 1001 });
    expect(tooDear.status).toBe(422);
    expect((await request(app).patch("/api/deals/999999999").set(as(admin)).send({ name: "x" })).status).toBe(404);
  });

  it("deleting an ordered deal is a 409; an unused one is deleted", async () => {
    expect((await request(app).delete(`/api/deals/${dealId}`).set(as(admin))).status).toBe(409);
    const all = await request(app).get("/api/deals/manage").set(as(admin));
    const unused = all.body.data.find((d: { name: string }) => d.name === `deal-test-future-${stamp}`);
    expect((await request(app).delete(`/api/deals/${unused.id}`).set(as(admin))).status).toBe(204);
  });
});
