import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { signToken } from "../../src/legacy/jwt.js";
import { prisma } from "../../src/legacy/prisma.js";

const app = createApp();
const stamp = Date.now();
const domain = "@orders.example.test";
let admin = "";
let alice = "";
let bob = "";
let pizzaId = 0;
let colaId = 0;
let hiddenId = 0;

beforeAll(async () => {
  const passwordHash = await bcrypt.hash("irrelevant-password", 4);
  const mk = (n: string, role: "ADMIN" | "CUSTOMER") =>
    prisma.legacyUser.create({ data: { email: `${n}-${stamp}${domain}`, name: n, passwordHash, role } });
  const [a, c1, c2] = await Promise.all([mk("admin", "ADMIN"), mk("alice", "CUSTOMER"), mk("bob", "CUSTOMER")]);
  admin = `Bearer ${signToken(a)}`;
  alice = `Bearer ${signToken(c1)}`;
  bob = `Bearer ${signToken(c2)}`;

  const cat = await prisma.legacyCategory.create({ data: { name: `ord-cat-${stamp}` } });
  const item = (name: string, priceCents: number, available = true) =>
    prisma.legacyMenuItem.create({ data: { name: `ord-${name}-${stamp}`, priceCents, available, categoryId: cat.id } });
  pizzaId = (await item("pizza", 1250)).id;
  colaId = (await item("cola", 300)).id;
  hiddenId = (await item("hidden", 500, false)).id;
});

afterAll(async () => {
  // Children first: orders (lines cascade) -> menu items -> categories -> users.
  await prisma.legacyOrder.deleteMany({ where: { user: { email: { endsWith: domain } } } });
  await prisma.legacyMenuItem.deleteMany({ where: { name: { startsWith: "ord-" } } });
  await prisma.legacyCategory.deleteMany({ where: { name: { startsWith: "ord-cat-" } } });
  await prisma.legacyUser.deleteMany({ where: { email: { endsWith: domain } } });
  await prisma.$disconnect();
});

describe("orders", () => {
  let orderId = 0;

  it("requires authentication", async () => {
    expect((await request(app).get("/api/orders")).status).toBe(401);
    expect((await request(app).post("/api/orders").send({})).status).toBe(401);
  });

  it("creates an order, computing the total server-side and merging duplicate lines", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", alice)
      .send({
        items: [
          { menuItemId: pizzaId, quantity: 1 },
          { menuItemId: pizzaId, quantity: 1 },
          { menuItemId: colaId, quantity: 2 },
        ],
        totalCents: 1, // must be ignored
        notes: "  No onions please  ",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.totalCents).toBe(2 * 1250 + 2 * 300);
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.notes).toBe("No onions please");
    expect(res.body.data.user.email).toContain(domain);
    expect(res.body.data.items).toHaveLength(2);
    orderId = res.body.data.id;
  });

  it("rejects empty, unknown and unavailable items", async () => {
    const post = (items: unknown) => request(app).post("/api/orders").set("Authorization", alice).send({ items });
    expect((await post([])).status).toBe(422);
    expect((await post([{ menuItemId: pizzaId, quantity: 0 }])).status).toBe(422);
    expect((await post([{ menuItemId: 999999999, quantity: 1 }])).status).toBe(422);
    expect((await post([{ menuItemId: hiddenId, quantity: 1 }])).status).toBe(422);
  });

  it("isolates customers: owner and admin can read, others get 404", async () => {
    expect((await request(app).get(`/api/orders/${orderId}`).set("Authorization", alice)).status).toBe(200);
    expect((await request(app).get(`/api/orders/${orderId}`).set("Authorization", admin)).status).toBe(200);
    expect((await request(app).get(`/api/orders/${orderId}`).set("Authorization", bob)).status).toBe(404);

    const bobList = await request(app).get("/api/orders").set("Authorization", bob);
    expect(bobList.body.data).toEqual([]);
    const aliceList = await request(app).get("/api/orders?status=PENDING").set("Authorization", alice);
    expect(aliceList.body.meta.total).toBe(1);
  });

  it("only admins can change status, and only along valid transitions", async () => {
    const patch = (auth: string, status: string) =>
      request(app).patch(`/api/orders/${orderId}/status`).set("Authorization", auth).send({ status });
    expect((await patch(alice, "CONFIRMED")).status).toBe(403);
    expect((await patch(admin, "READY")).status).toBe(409); // PENDING -> READY not allowed
    expect((await patch(admin, "NOPE")).status).toBe(422);
    const ok = await patch(admin, "CONFIRMED");
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe("CONFIRMED");
  });

  it("customers can cancel only pending orders", async () => {
    // orderId is now CONFIRMED, so alice can't cancel it
    expect((await request(app).post(`/api/orders/${orderId}/cancel`).set("Authorization", alice)).status).toBe(409);

    const fresh = await request(app)
      .post("/api/orders")
      .set("Authorization", alice)
      .send({ items: [{ menuItemId: colaId, quantity: 1 }] });
    const id = fresh.body.data.id;
    expect((await request(app).post(`/api/orders/${id}/cancel`).set("Authorization", bob)).status).toBe(404);
    const cancelled = await request(app).post(`/api/orders/${id}/cancel`).set("Authorization", alice);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");
    expect((await request(app).post(`/api/orders/${id}/cancel`).set("Authorization", alice)).status).toBe(409);
  });

  it("keeps the price snapshot when the menu price changes later", async () => {
    await prisma.legacyMenuItem.update({ where: { id: pizzaId }, data: { priceCents: 9999 } });
    const res = await request(app).get(`/api/orders/${orderId}`).set("Authorization", alice);
    expect(res.body.data.totalCents).toBe(2 * 1250 + 2 * 300);
    const pizzaLine = res.body.data.items.find((i: { menuItemId: number }) => i.menuItemId === pizzaId);
    expect(pizzaLine.unitPriceCents).toBe(1250);
  });
});
