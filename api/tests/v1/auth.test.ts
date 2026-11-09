import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { bearer, createFixture, createStaff, login, loginOwner, type Fixture } from "../helpers/fixtures.js";

const app = createApp();
let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture();
});
afterAll(async () => {
  await fx.cleanup();
  await unscopedDb.$disconnect();
});

describe("auth: login", () => {
  it("logs in, returns an access token + me, and sets an httpOnly refresh cookie", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: fx.ownerEmail, password: fx.ownerPassword });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.expiresIn).toBeGreaterThan(0);
    expect(res.body.data.me.user.email).toBe(fx.ownerEmail);
    expect(res.body.data.me.permissions.length).toBeGreaterThan(50); // the owner holds everything
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(cookie).toMatch(/rf_refresh=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|refreshToken/);
  });

  it("rejects wrong passwords and unknown emails with the same error", async () => {
    const wrong = await request(app).post("/api/v1/auth/login").send({ email: fx.ownerEmail, password: "wrong-password-123" });
    const unknown = await request(app).post("/api/v1/auth/login").send({ email: "nobody@nowhere.test", password: "wrong-password-123" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe("UNAUTHENTICATED");
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(wrong.body.error.requestId).toEqual(expect.any(String));
  });

  it("records login history (success and failure)", async () => {
    await login(app, fx.ownerEmail, fx.ownerPassword);
    await login(app, fx.ownerEmail, "definitely-wrong-123");
    const events = await unscopedDb.loginEvent.findMany({ where: { tenantId: fx.tenantId } });
    expect(events.some((e) => e.success)).toBe(true);
    expect(events.some((e) => !e.success && e.failureReason === "wrong_password")).toBe(true);
  });

  it("validates input", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: "not-an-email", password: "" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses disabled users", async () => {
    const staff = await createStaff(fx, { roleName: "Cashier" });
    await unscopedDb.user.update({ where: { id: staff.id }, data: { status: "DISABLED" } });
    expect((await login(app, staff.email, staff.password)).status).toBe(401);
  });
});

describe("auth: access tokens", () => {
  it("GET /auth/me needs a valid token", async () => {
    expect((await request(app).get("/api/v1/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/v1/auth/me").set(bearer("garbage"))).status).toBe(401);
    const owner = await loginOwner(app, fx);
    const me = await request(app).get("/api/v1/auth/me").set(bearer(owner.token));
    expect(me.status).toBe(200);
    expect(me.body.data.tenant.slug).toBe(fx.slug);
  });

  it("a legacy storefront token can never be used as a staff token", async () => {
    const { signToken } = await import("../../src/legacy/jwt.js");
    const legacy = signToken({ id: 1, role: "ADMIN" });
    expect((await request(app).get("/api/v1/auth/me").set(bearer(legacy))).status).toBe(401);
  });
});

describe("auth: refresh rotation and revocation", () => {
  it("rotates the refresh token, and replaying the old one revokes the session", async () => {
    const first = await loginOwner(app, fx);
    const refreshed = await request(app).post("/api/v1/auth/refresh").set("Cookie", first.cookie);
    expect(refreshed.status).toBe(200);
    const newCookie = (refreshed.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    expect(newCookie).not.toBe(first.cookie);

    // the new session works
    expect((await request(app).get("/api/v1/auth/me").set(bearer(refreshed.body.data.accessToken))).status).toBe(200);

    // replaying the OLD cookie is detected as theft: it fails AND kills the session
    const replay = await request(app).post("/api/v1/auth/refresh").set("Cookie", first.cookie);
    expect(replay.status).toBe(401);
    expect((await request(app).post("/api/v1/auth/refresh").set("Cookie", newCookie)).status).toBe(401);
    expect((await request(app).get("/api/v1/auth/me").set(bearer(refreshed.body.data.accessToken))).status).toBe(401);
  });

  it("logout revokes the session immediately", async () => {
    const s = await loginOwner(app, fx);
    expect((await request(app).post("/api/v1/auth/logout").set("Cookie", s.cookie)).status).toBe(204);
    expect((await request(app).get("/api/v1/auth/me").set(bearer(s.token))).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/refresh").set("Cookie", s.cookie)).status).toBe(401);
  });

  it("refresh without a cookie is 401", async () => {
    expect((await request(app).post("/api/v1/auth/refresh")).status).toBe(401);
  });
});

describe("auth: change password", () => {
  it("changes the password, signs out other sessions, keeps the current one", async () => {
    const staff = await createStaff(fx, { roleName: "Cashier" });
    const a = await login(app, staff.email, staff.password);
    const b = await login(app, staff.email, staff.password);

    const bad = await request(app).post("/api/v1/auth/change-password").set(bearer(a.token)).send({ currentPassword: "nope-nope-nope", newPassword: "Another-Passw0rd-1" });
    expect(bad.status).toBe(422);

    const ok = await request(app).post("/api/v1/auth/change-password").set(bearer(a.token)).send({ currentPassword: staff.password, newPassword: "Another-Passw0rd-1" });
    expect(ok.status).toBe(204);
    expect((await request(app).get("/api/v1/auth/me").set(bearer(a.token))).status).toBe(200); // current kept
    expect((await request(app).get("/api/v1/auth/me").set(bearer(b.token))).status).toBe(401); // other session gone
    expect((await login(app, staff.email, staff.password)).status).toBe(401); // old password dead
    expect((await login(app, staff.email, "Another-Passw0rd-1")).status).toBe(200);
  });
});

describe("api envelope", () => {
  it("unknown /api/v1 routes return the JSON error envelope", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
  it("health is public", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: "ok" } });
  });
});
