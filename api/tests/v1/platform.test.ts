import { randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/core/auth/passwords.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { purgePlatformUser, purgeTenant } from "../../src/core/db/purge.js";
import { platformRouteRegistry } from "../../src/core/platform/secured.js";
import { bearer, createFixture, loginOwner, type Fixture } from "../helpers/fixtures.js";
import { api } from "../helpers/http.js";

const app = createApp();
const PASSWORD = "Platform-Passw0rd-1234";

async function createPlatformAdmin() {
  const email = `team${randomBytes(4).toString("hex")}@restoflux.test`;
  const user = await unscopedDb.platformUser.create({ data: { email, name: "Team Member", passwordHash: await hashPassword(PASSWORD) } });
  return { id: user.id, email };
}
const platformLogin = (email: string, password = PASSWORD) => request(app).post("/api/v1/platform/auth/login").send({ email, password });
const asPlatform = (token: string) => ({
  get: (p: string) => request(app).get(`/api/v1/platform${p}`).set(bearer(token)),
  post: (p: string, body: unknown = {}) => request(app).post(`/api/v1/platform${p}`).set(bearer(token)).send(body as object),
  patch: (p: string, body: unknown = {}) => request(app).patch(`/api/v1/platform${p}`).set(bearer(token)).send(body as object),
});

describe("platform route registry", () => {
  it("only login, refresh and logout are public; everything else needs a platform token", () => {
    const pub = platformRouteRegistry.filter((r) => r.access === "public").map((r) => `${r.method.toUpperCase()} ${r.path}`).sort();
    expect(pub).toEqual(["POST /api/v1/platform/auth/login", "POST /api/v1/platform/auth/logout", "POST /api/v1/platform/auth/refresh"]);
    expect(platformRouteRegistry.filter((r) => r.access === "platform").length).toBeGreaterThan(8);
  });

  it("anonymous callers get 401 on every platform route", async () => {
    for (const r of platformRouteRegistry.filter((x) => x.access === "platform")) {
      const path = r.path.replace(/:\w+/g, crypto.randomUUID());
      const res = await request(app)[r.method](path).send({});
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });
});

describe("platform console", () => {
  let admin: { id: string; email: string };
  let token = "";
  let tenantA: Fixture;
  const created: string[] = [];

  beforeAll(async () => {
    admin = await createPlatformAdmin();
    const res = await platformLogin(admin.email);
    token = res.body.data.accessToken;
    tenantA = await createFixture();
  });
  afterAll(async () => {
    for (const id of created) await purgeTenant(id);
    await tenantA.cleanup();
    await purgePlatformUser(admin.id);
    await unscopedDb.$disconnect();
  });

  it("signs in, returns the profile, and rejects bad credentials with the same message", async () => {
    const ok = await platformLogin(admin.email);
    expect(ok.status).toBe(200);
    expect(ok.body.data.me).toMatchObject({ email: admin.email });
    expect(ok.headers["set-cookie"]?.[0]).toContain("rf_platform=");
    const bad = await platformLogin(admin.email, "wrong-password-123");
    const unknown = await platformLogin("nobody@restoflux.test", "wrong-password-123");
    expect(bad.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);
    const me = await asPlatform(token).get("/auth/me");
    expect(me.body.data.email).toBe(admin.email);
  });

  it("keeps the two worlds apart: a restaurant token is not a platform token and vice versa", async () => {
    const owner = await loginOwner(app, tenantA);
    expect((await asPlatform(owner.token).get("/organizations")).status).toBe(401);
    expect((await api(app, token).get("/users")).status).toBe(401);
    expect((await api(app, token).get("/auth/me")).status).toBe(401);
  });

  it("refreshes with the cookie and detects a replayed refresh token", async () => {
    const login = await platformLogin(admin.email);
    const cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
    const first = await request(app).post("/api/v1/platform/auth/refresh").set("Cookie", cookie);
    expect(first.status).toBe(200);
    const replay = await request(app).post("/api/v1/platform/auth/refresh").set("Cookie", cookie);
    expect(replay.status).toBe(401);
    const rotated = first.headers["set-cookie"]![0]!.split(";")[0]!;
    expect((await request(app).post("/api/v1/platform/auth/refresh").set("Cookie", rotated)).status).toBe(401); // whole session revoked
  });

  it("lists organizations with counts, search and status filter", async () => {
    const res = await asPlatform(token).get(`/organizations?q=${tenantA.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: tenantA.tenantId, status: "ACTIVE", counts: { brands: 0, locations: 0, users: 1 } });
    const none = await asPlatform(token).get(`/organizations?q=${tenantA.slug}&status=SUSPENDED`);
    expect(none.body.data).toHaveLength(0);
    expect((await asPlatform(token).get("/organizations?sort=passwordHash")).status).toBe(422); // sort whitelist
  });

  it("creates an organization with a trial, a generated owner password shown once, and an audit entry", async () => {
    const slug = `new${randomBytes(4).toString("hex")}`;
    const res = await asPlatform(token).post("/organizations", { name: "New Cafe", slug, currency: "PKR", ownerName: "Nadia", ownerEmail: `nadia@${slug}.test` });
    expect(res.status).toBe(201);
    created.push(res.body.data.id);
    expect(res.body.data).toMatchObject({ status: "TRIAL", plan: "standard" });
    expect(res.body.data.trialEndsAt).toBeTruthy();
    const password = res.body.meta.ownerPassword as string;
    expect(password.length).toBeGreaterThanOrEqual(12);

    // the generated credentials really work, in the tenant world
    const owner = await request(app).post("/api/v1/auth/login").send({ email: `nadia@${slug}.test`, password });
    expect(owner.status).toBe(200);
    expect(owner.body.data.me.tenant).toMatchObject({ status: "TRIAL", slug });
    expect(owner.body.data.me.roles.map((r: { name: string }) => r.name)).toContain("Owner");

    const log = await unscopedDb.platformAuditLog.findMany({ where: { targetTenantId: res.body.data.id } });
    expect(log.map((l) => l.action)).toContain("organization.create");
    expect(JSON.stringify(log)).not.toContain(password);
  });

  it("does not echo back a password the caller chose, and rejects duplicates and weak passwords", async () => {
    const slug = `own${randomBytes(4).toString("hex")}`;
    const res = await asPlatform(token).post("/organizations", { name: "Chosen Pw", slug, ownerName: "A", ownerEmail: `a@${slug}.test`, ownerPassword: "A-Long-Chosen-Passw0rd" });
    expect(res.status).toBe(201);
    created.push(res.body.data.id);
    expect(res.body.meta).toBeUndefined();

    expect((await asPlatform(token).post("/organizations", { name: "Dup", slug, ownerName: "A", ownerEmail: `b@${slug}.test` })).status).toBe(422); // slug taken
    expect((await asPlatform(token).post("/organizations", { name: "Dup", slug: `x${slug}`, ownerName: "A", ownerEmail: `a@${slug}.test` })).status).toBe(422); // email taken
    expect((await asPlatform(token).post("/organizations", { name: "Weak", slug: `w${slug}`, ownerName: "A", ownerEmail: `w@${slug}.test`, ownerPassword: "short" })).status).toBe(422);
  });

  it("suspends an organization: staff are signed out and cannot sign in; reactivating restores access", async () => {
    const owner = await loginOwner(app, tenantA);
    expect((await api(app, owner.token).get("/users")).status).toBe(200);

    expect((await asPlatform(token).post(`/organizations/${tenantA.tenantId}/status`, { status: "SUSPENDED" })).status).toBe(422); // reason required
    const sus = await asPlatform(token).post(`/organizations/${tenantA.tenantId}/status`, { status: "SUSPENDED", reason: "Unpaid invoice" });
    expect(sus.status).toBe(200);
    expect(sus.body.data).toMatchObject({ status: "SUSPENDED", suspendedReason: "Unpaid invoice" });

    expect((await api(app, owner.token).get("/users")).status).toBe(401); // existing token dies at once
    expect((await loginOwner(app, tenantA)).status).toBe(401); // cannot sign in again
    expect((await request(app).post("/api/v1/auth/refresh").set("Cookie", owner.cookie)).status).toBe(401);

    const back = await asPlatform(token).post(`/organizations/${tenantA.tenantId}/status`, { status: "ACTIVE" });
    expect(back.body.data).toMatchObject({ status: "ACTIVE", suspendedReason: null });
    expect((await loginOwner(app, tenantA)).status).toBe(200);

    const actions = (await unscopedDb.platformAuditLog.findMany({ where: { targetTenantId: tenantA.tenantId }, orderBy: { occurredAt: "asc" } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["organization.suspended", "organization.active"]));
  });

  it("enforces plan limits on users, and the platform can raise them", async () => {
    await asPlatform(token).patch(`/organizations/${tenantA.tenantId}`, { maxUsers: 1, plan: "starter" });
    const owner = await loginOwner(app, tenantA);
    const newUser = { name: "Extra", email: `extra@${tenantA.slug}.test`, password: "Another-Passw0rd-12", roleIds: [tenantA.roleIds["Cashier"]!], allLocations: true };
    const blocked = await api(app, owner.token).post("/users", newUser);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PLAN_LIMIT");

    await asPlatform(token).patch(`/organizations/${tenantA.tenantId}`, { maxUsers: null });
    expect((await api(app, owner.token).post("/users", newUser)).status).toBe(201);
  });

  it("resets an owner's password (generated, shown once) and signs the owner out", async () => {
    const owner = await loginOwner(app, tenantA);
    const res = await asPlatform(token).post(`/organizations/${tenantA.tenantId}/reset-owner-password`, { userId: tenantA.ownerUserId });
    expect(res.status).toBe(200);
    const fresh = res.body.meta.password as string;
    expect((await api(app, owner.token).get("/users")).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/login").send({ email: tenantA.ownerEmail, password: tenantA.ownerPassword })).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/login").send({ email: tenantA.ownerEmail, password: fresh })).status).toBe(200);
    const other = await asPlatform(token).post(`/organizations/${tenantA.tenantId}/reset-owner-password`, { userId: crypto.randomUUID() });
    expect(other.status).toBe(404); // only owners of THIS organization
  });

  it("manages the team: add a member, who can sign in; disabling signs them out; you cannot disable yourself", async () => {
    const email = `new${randomBytes(3).toString("hex")}@restoflux.test`;
    const add = await asPlatform(token).post("/admins", { name: "New Hire", email, password: "Hire-Passw0rd-12345" });
    expect(add.status).toBe(201);
    const member = await platformLogin(email, "Hire-Passw0rd-12345");
    expect(member.status).toBe(200);

    expect((await asPlatform(token).patch(`/admins/${add.body.data.id}`, { status: "DISABLED" })).status).toBe(200);
    expect((await asPlatform(member.body.data.accessToken).get("/organizations")).status).toBe(401);
    expect((await platformLogin(email, "Hire-Passw0rd-12345")).status).toBe(401);
    expect((await asPlatform(token).patch(`/admins/${admin.id}`, { status: "DISABLED" })).status).toBe(409);
    await purgePlatformUser(add.body.data.id);
  });

  it("serves the platform audit log and the summary", async () => {
    const log = await asPlatform(token).get(`/audit-logs?tenantId=${tenantA.tenantId}`);
    expect(log.status).toBe(200);
    expect(log.body.data.length).toBeGreaterThan(2);
    expect(log.body.data[0]).toHaveProperty("actorName", "Team Member");
    const sum = await asPlatform(token).get("/organizations/summary");
    expect(sum.body.data.organizations).toBeGreaterThanOrEqual(2);
  });

  it("platform audit entries cannot be edited or deleted", async () => {
    const row = await unscopedDb.platformAuditLog.findFirstOrThrow({ where: { targetTenantId: tenantA.tenantId } });
    await expect(unscopedDb.platformAuditLog.update({ where: { id: row.id }, data: { reason: "tampered" } })).rejects.toThrow();
    await expect(unscopedDb.platformAuditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});
