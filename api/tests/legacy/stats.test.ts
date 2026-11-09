import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { signToken } from "../../src/legacy/jwt.js";
import { prisma } from "../../src/legacy/prisma.js";

// The stats endpoint is global, so these tests insert orders in a date range (March 2001)
// that can never overlap the seeded demo data, and assert on exactly that range.
const app = createApp();
const stamp = Date.now();
const domain = "@stats.example.test";
const range = "from=2001-03-01&to=2001-03-03";
let admin = "";
let customer = "";
let aName = "";
let bName = "";

beforeAll(async () => {
  const passwordHash = await bcrypt.hash("irrelevant-password", 4);
  const [a, c] = await Promise.all(
    (["ADMIN", "CUSTOMER"] as const).map((role) =>
      prisma.legacyUser.create({ data: { email: `${role.toLowerCase()}-${stamp}${domain}`, name: role, passwordHash, role } }),
    ),
  );
  admin = `Bearer ${signToken(a!)}`;
  customer = `Bearer ${signToken(c!)}`;

  const cat = await prisma.legacyCategory.create({ data: { name: `stats-cat-${stamp}` } });
  aName = `stats-a-${stamp}`;
  bName = `stats-b-${stamp}`;
  const itemA = await prisma.legacyMenuItem.create({ data: { name: aName, priceCents: 1000, categoryId: cat.id } });
  const itemB = await prisma.legacyMenuItem.create({ data: { name: bName, priceCents: 500, categoryId: cat.id } });
  const deal = await prisma.legacyDeal.create({
    data: {
      name: `stats-deal-${stamp}`,
      dealPriceCents: 2000,
      originalPriceCents: 2000,
      items: { create: [{ menuItemId: itemA.id, quantity: 1 }, { menuItemId: itemB.id, quantity: 2 }] },
    },
  });

  const userId = c!.id;
  const line = (menuItemId: number, quantity: number, unitPriceCents: number) => ({ menuItemId, quantity, unitPriceCents });
  // Times are Pakistan time (+05:00). o2 and o3 sit either side of local midnight, which is
  // the same UTC day, so they only land on different days if bucketing uses the right timezone.
  await prisma.legacyOrder.create({ data: { userId, status: "COMPLETED", channel: "WEB", totalCents: 2000, createdAt: new Date("2001-03-01T12:00:00+05:00"), items: { create: [line(itemA.id, 2, 1000)] } } });
  await prisma.legacyOrder.create({ data: { userId, status: "PENDING", channel: "ANDROID", totalCents: 500, createdAt: new Date("2001-03-01T23:30:00+05:00"), items: { create: [line(itemB.id, 1, 500)] } } });
  await prisma.legacyOrder.create({ data: { userId, status: "CANCELLED", channel: "POS", totalCents: 700, createdAt: new Date("2001-03-02T00:10:00+05:00"), items: { create: [line(itemA.id, 1, 1000)] } } });
  await prisma.legacyOrder.create({ data: { userId, status: "COMPLETED", channel: "IOS", totalCents: 4000, createdAt: new Date("2001-03-03T10:00:00+05:00"), deals: { create: [{ dealId: deal.id, dealName: deal.name, quantity: 2, unitPriceCents: 2000 }] } } });
});

afterAll(async () => {
  await prisma.legacyOrder.deleteMany({ where: { user: { email: { endsWith: domain } } } });
  await prisma.legacyDeal.deleteMany({ where: { name: { startsWith: "stats-deal-" } } });
  await prisma.legacyMenuItem.deleteMany({ where: { name: { startsWith: "stats-" } } });
  await prisma.legacyCategory.deleteMany({ where: { name: { startsWith: "stats-cat-" } } });
  await prisma.legacyUser.deleteMany({ where: { email: { endsWith: domain } } });
  await prisma.$disconnect();
});

describe("stats", () => {
  it("is admin only", async () => {
    expect((await request(app).get(`/api/stats?${range}`)).status).toBe(401);
    expect((await request(app).get(`/api/stats?${range}`).set("Authorization", customer)).status).toBe(403);
  });

  it("computes status counts/amounts, KPIs, channels, daily trend and top items", async () => {
    const res = await request(app).get(`/api/stats?${range}`).set("Authorization", admin);
    expect(res.status).toBe(200);
    const s = res.body;

    expect(s.range).toMatchObject({ from: "2001-03-01", to: "2001-03-03" });
    expect(s.statuses.COMPLETED).toEqual({ count: 2, amountCents: 6000 });
    expect(s.statuses.PENDING).toEqual({ count: 1, amountCents: 500 });
    expect(s.statuses.CANCELLED).toEqual({ count: 1, amountCents: 700 });
    expect(s.statuses.PREPARING).toEqual({ count: 0, amountCents: 0 });

    // sales exclude the cancelled order: 2000 + 500 + 4000
    expect(s.kpis).toEqual({ totalOrders: 4, totalSalesCents: 6500, averageOrderValueCents: 2167, cancelledRate: 0.25 });

    expect(s.channels).toEqual([
      { channel: "WEB", count: 1 },
      { channel: "POS", count: 1 },
      { channel: "ANDROID", count: 1 },
      { channel: "IOS", count: 1 },
    ]);

    expect(s.daily).toEqual([
      { date: "2001-03-01", orders: 2, salesCents: 2500 },
      { date: "2001-03-02", orders: 1, salesCents: 0 }, // the cancelled order, bucketed by local midnight
      { date: "2001-03-03", orders: 1, salesCents: 4000 },
    ]);

    // a: 2 (order 1) + 1x2 (deal parts) = 4; b: 1 + 2x2 = 5. The cancelled order is ignored.
    expect(s.topItems).toEqual([
      { menuItemId: expect.any(Number), name: bName, quantity: 5 },
      { menuItemId: expect.any(Number), name: aName, quantity: 4 },
    ]);
  });

  it("an empty range returns zeros, not errors", async () => {
    const res = await request(app).get("/api/stats?from=2001-04-01&to=2001-04-02").set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body.kpis).toEqual({ totalOrders: 0, totalSalesCents: 0, averageOrderValueCents: 0, cancelledRate: 0 });
    expect(res.body.daily).toHaveLength(2);
    expect(res.body.topItems).toEqual([]);
  });

  it("defaults to the last 30 days and validates the range", async () => {
    const def = await request(app).get("/api/stats").set("Authorization", admin);
    expect(def.status).toBe(200);
    expect(def.body.daily).toHaveLength(30);
    const get = (q: string) => request(app).get(`/api/stats?${q}`).set("Authorization", admin);
    expect((await get("from=2001-03-05&to=2001-03-01")).status).toBe(422);
    expect((await get("from=nonsense")).status).toBe(422);
    expect((await get("from=2000-01-01&to=2001-12-31")).status).toBe(422); // > 366 days
  });
});
