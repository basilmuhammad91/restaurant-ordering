import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/legacy/prisma.js";

// These hit the real Neon DB. Emails are unique per run and removed afterwards
// (a dedicated test DB/branch is the better long-term setup).
const app = createApp();
const email = `test-${Date.now()}@auth.example.test`;
const password = "correct-horse-battery";

afterAll(async () => {
  await prisma.legacyUser.deleteMany({ where: { email: { endsWith: "@auth.example.test" } } });
  await prisma.$disconnect();
});

describe("auth", () => {
  let token = "";

  it("registers a user and never exposes the password hash", async () => {
    const res = await request(app).post("/api/auth/register").send({ name: "Tester", email, password });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, role: "CUSTOMER" });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(typeof res.body.token).toBe("string");
  });

  it("ignores a client-supplied role", async () => {
    const e = `admin-${Date.now()}@auth.example.test`;
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Sneaky", email: e, password, role: "ADMIN" });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("CUSTOMER");
  });

  it("rejects duplicate email with 409", async () => {
    const res = await request(app).post("/api/auth/register").send({ name: "Dup", email, password });
    expect(res.status).toBe(409);
  });

  it("validates input with 422", async () => {
    const res = await request(app).post("/api/auth/register").send({ name: "", email: "nope", password: "short" });
    expect(res.status).toBe(422);
    expect(res.body.details).toHaveProperty("email");
  });

  it("logs in with correct credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(200);
    token = res.body.token;
    expect(token).toBeTruthy();
  });

  it("rejects wrong password and unknown email identically", async () => {
    const a = await request(app).post("/api/auth/login").send({ email, password: "wrong-password" });
    const b = await request(app).post("/api/auth/login").send({ email: "who@auth.example.test", password });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it("GET /me requires a valid token", async () => {
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", "Bearer garbage")).status).toBe(401);
    const ok = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe(email);
  });
});
