import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { signToken } from "../../src/legacy/jwt.js";
import { prisma } from "../../src/legacy/prisma.js";

const app = createApp();
const stamp = Date.now();
let adminAuth = "";
let customerAuth = "";

// Users are inserted directly (like a Laravel factory) so we can have an ADMIN.
beforeAll(async () => {
  const passwordHash = await bcrypt.hash("irrelevant-password", 4);
  const admin = await prisma.legacyUser.create({
    data: { email: `menu-admin-${stamp}@menu.example.test`, name: "Admin", passwordHash, role: "ADMIN" },
  });
  const customer = await prisma.legacyUser.create({
    data: { email: `menu-cust-${stamp}@menu.example.test`, name: "Cust", passwordHash },
  });
  adminAuth = `Bearer ${signToken(admin)}`;
  customerAuth = `Bearer ${signToken(customer)}`;
});

afterAll(async () => {
  await prisma.legacyMenuItem.deleteMany({ where: { name: { startsWith: "test-pizza-" } } });
  await prisma.legacyCategory.deleteMany({ where: { name: { startsWith: "test-cat-" } } });
  await prisma.legacyUser.deleteMany({ where: { email: { endsWith: "@menu.example.test" } } });
  await prisma.$disconnect();
});

describe("menu", () => {
  let categoryId = 0;
  let itemId = 0;

  it("blocks anonymous and non-admin writes", async () => {
    const payload = { name: `test-cat-${stamp}` };
    expect((await request(app).post("/api/categories").send(payload)).status).toBe(401);
    const res = await request(app).post("/api/categories").set("Authorization", customerAuth).send(payload);
    expect(res.status).toBe(403);
  });

  it("admin creates a category; duplicate name is 409", async () => {
    const payload = { name: `test-cat-${stamp}` };
    const res = await request(app).post("/api/categories").set("Authorization", adminAuth).send(payload);
    expect(res.status).toBe(201);
    categoryId = res.body.data.id;
    const dup = await request(app).post("/api/categories").set("Authorization", adminAuth).send(payload);
    expect(dup.status).toBe(409);
  });

  it("admin creates a menu item and validates input", async () => {
    const res = await request(app)
      .post("/api/menu-items")
      .set("Authorization", adminAuth)
      .send({ name: `test-pizza-${stamp}`, priceCents: 1299, categoryId });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ priceCents: 1299, available: true });
    expect(res.body.data.category.id).toBe(categoryId);
    itemId = res.body.data.id;

    const bad = await request(app)
      .post("/api/menu-items")
      .set("Authorization", adminAuth)
      .send({ name: "test-bad", priceCents: 12.5, categoryId });
    expect(bad.status).toBe(422);
    expect(bad.body.details).toHaveProperty("priceCents");
  });

  it("rejects an item with a nonexistent category (409)", async () => {
    const res = await request(app)
      .post("/api/menu-items")
      .set("Authorization", adminAuth)
      .send({ name: "test-orphan", priceCents: 100, categoryId: 999999999 });
    expect(res.status).toBe(409);
  });

  it("lists publicly with filters and fetches one", async () => {
    const list = await request(app).get(`/api/menu-items?categoryId=${categoryId}&available=true`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((i: { id: number }) => i.id)).toEqual([itemId]);

    const one = await request(app).get(`/api/menu-items/${itemId}`);
    expect(one.status).toBe(200);
    expect((await request(app).get("/api/menu-items/999999999")).status).toBe(404);
    expect((await request(app).get("/api/menu-items/abc")).status).toBe(422);
  });

  it("partially updates an item", async () => {
    const res = await request(app)
      .patch(`/api/menu-items/${itemId}`)
      .set("Authorization", adminAuth)
      .send({ available: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ available: false, priceCents: 1299 });
    const hidden = await request(app).get(`/api/menu-items?categoryId=${categoryId}&available=true`);
    expect(hidden.body.data).toEqual([]);
  });

  it("cannot delete a category that still has items, then deletes in order", async () => {
    const auth = { Authorization: adminAuth };
    expect((await request(app).delete(`/api/categories/${categoryId}`).set(auth)).status).toBe(409);
    expect((await request(app).delete(`/api/menu-items/${itemId}`).set(auth)).status).toBe(204);
    expect((await request(app).delete(`/api/menu-items/${itemId}`).set(auth)).status).toBe(404);
    expect((await request(app).delete(`/api/categories/${categoryId}`).set(auth)).status).toBe(204);
  });
});
