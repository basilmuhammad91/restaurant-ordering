import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { createBaseOrg, createFixture, createLocation, createStaff, login, loginOwner, loginStaff, type BaseOrg, type Fixture } from "../helpers/fixtures.js";
import { api, auditFor } from "../helpers/http.js";

const app = createApp();
let fx: Fixture;
let owner: ReturnType<typeof api>;
let base: BaseOrg;
let loc1: { id: string };

const newUser = (over: object = {}) => ({
  name: "New Person", email: `new-${crypto.randomUUID().slice(0, 8)}@${fx.slug}.test`, password: "Plain-Passw0rd-12", roleIds: [fx.roleIds["Cashier"]!], allLocations: false, locationIds: [loc1.id], ...over,
});

beforeAll(async () => {
  fx = await createFixture();
  owner = api(app, (await loginOwner(app, fx)).token);
  base = await createBaseOrg(fx);
  loc1 = await createLocation(fx, base, "UL-1");
});
afterAll(async () => {
  await fx.cleanup();
  await unscopedDb.$disconnect();
});

describe("users: create, read, update", () => {
  it("creates a user with a role and branch, never returning hashes", async () => {
    const res = await owner.post("/users", newUser({ email: `alice@${fx.slug}.test` }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: `alice@${fx.slug}.test`, status: "ACTIVE", allLocations: false, locationIds: [loc1.id], hasPin: false });
    expect(res.body.data.roles.map((r: any) => r.name)).toEqual(["Cashier"]);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|posPinHash|\$2b\$/);

    const logged = await login(app, `alice@${fx.slug}.test`, "Plain-Passw0rd-12");
    expect(logged.status).toBe(200);
    expect(logged.me.permissions).toContain("pos.access");
    expect(logged.me.locations.map((l: any) => l.id)).toEqual([loc1.id]);
  });

  it("emails are unique and stored lower-case", async () => {
    const email = `Mixed.Case-${crypto.randomUUID().slice(0, 6)}@${fx.slug}.test`;
    const a = await owner.post("/users", newUser({ email }));
    expect(a.status).toBe(201);
    expect(a.body.data.email).toBe(email.toLowerCase());
    expect((await owner.post("/users", newUser({ email: email.toLowerCase() }))).status).toBe(409);
  });

  it("validates passwords, roles and branches", async () => {
    expect((await owner.post("/users", newUser({ password: "short" }))).status).toBe(422);
    expect((await owner.post("/users", newUser({ roleIds: [crypto.randomUUID()] }))).status).toBe(422);
    expect((await owner.post("/users", newUser({ locationIds: [crypto.randomUUID()] }))).status).toBe(422);
    expect((await owner.post("/users", newUser({ roleIds: [] }))).status).toBe(422);
  });

  it("roles with financial access need a 12+ character password", async () => {
    const weak = await owner.post("/users", newUser({ roleIds: [fx.roleIds["Branch Manager"]!], password: "Elevenchar1" }));
    expect(weak.status).toBe(422);
    expect(weak.body.error.details.fieldErrors).toHaveProperty("password");
    expect((await owner.post("/users", newUser({ roleIds: [fx.roleIds["Branch Manager"]!], password: "Twelve-chars1" }))).status).toBe(201);
  });

  it("lists, searches and filters users", async () => {
    const a = await owner.post("/users", newUser({ name: "Zainab Zubair", email: `zz-${crypto.randomUUID().slice(0, 6)}@${fx.slug}.test` }));
    const byName = await owner.get("/users?q=zainab");
    expect(byName.body.data.map((u: any) => u.id)).toEqual([a.body.data.id]);
    const byRole = await owner.get(`/users?roleId=${fx.roleIds["Cashier"]}&pageSize=100`);
    expect(byRole.body.data.every((u: any) => u.roles.some((r: any) => r.name === "Cashier"))).toBe(true);
    expect(byRole.body.meta.total).toBeGreaterThanOrEqual(1);
    expect((await owner.get("/users?sort=passwordHash")).status).toBe(422);
  });

  it("updates profile fields and audits before/after without leaking secrets", async () => {
    const created = await owner.post("/users", newUser());
    const id = created.body.data.id;
    const upd = await owner.patch(`/users/${id}`, { name: "Renamed Person", phone: "+92 300 1234567" });
    expect(upd.body.data).toMatchObject({ name: "Renamed Person", phone: "+92 300 1234567" });
    const rows = await auditFor(fx.tenantId, "User", id);
    expect(rows.map((r) => r.action)).toEqual(["users.create", "users.update"]);
    expect(JSON.stringify(rows)).not.toMatch(/passwordHash|\$2b\$/);
  });
});

describe("users: credentials and sessions", () => {
  it("setting a PIN is audited and never returned; the hash is not exposed", async () => {
    const created = await owner.post("/users", newUser());
    const id = created.body.data.id;
    expect((await owner.put(`/users/${id}/pin`, { pin: "12" })).status).toBe(422);
    expect((await owner.put(`/users/${id}/pin`, { pin: "482916" })).status).toBe(204);
    const got = await owner.get(`/users/${id}`);
    expect(got.body.data.hasPin).toBe(true);
    expect(JSON.stringify(got.body)).not.toMatch(/482916|posPinHash/);
    expect((await auditFor(fx.tenantId, "User", id)).map((r) => r.action)).toContain("users.pin.set");
  });

  it("resetting a password signs the user out everywhere", async () => {
    const created = await owner.post("/users", newUser());
    const email = created.body.data.email;
    const s = await login(app, email, "Plain-Passw0rd-12");
    expect((await api(app, s.token).get("/auth/me")).status).toBe(200);

    expect((await owner.post(`/users/${created.body.data.id}/reset-password`, { password: "Brand-New-Passw0rd" })).status).toBe(204);
    expect((await api(app, s.token).get("/auth/me")).status).toBe(401);
    expect((await login(app, email, "Plain-Passw0rd-12")).status).toBe(401);
    expect((await login(app, email, "Brand-New-Passw0rd")).status).toBe(200);
  });

  it("disabling a user revokes their sessions IMMEDIATELY (the same access token stops working)", async () => {
    const staff = await createStaff(fx, { roleName: "Cashier" });
    const s = await loginStaff(app, staff);
    expect((await api(app, s.token).get("/auth/me")).status).toBe(200);

    expect((await owner.patch(`/users/${staff.id}`, { status: "DISABLED" })).status).toBe(200);
    expect((await api(app, s.token).get("/auth/me")).status).toBe(401);
    expect((await loginStaff(app, staff)).status).toBe(401);
    expect((await auditFor(fx.tenantId, "User", staff.id)).map((r) => r.action)).toContain("users.disable");
  });

  it("lists and revokes individual sessions, and shows login history", async () => {
    const staff = await createStaff(fx, { roleName: "Cashier" });
    const a = await loginStaff(app, staff);
    await loginStaff(app, staff);
    const sessions = await owner.get(`/users/${staff.id}/sessions`);
    expect(sessions.body.data).toHaveLength(2);
    expect(sessions.body.data[0]).not.toHaveProperty("refreshTokenHash");

    const del = await owner.del(`/users/${staff.id}/sessions/${sessions.body.data[0].id}`);
    expect(del.status).toBe(204);
    expect((await owner.get(`/users/${staff.id}/sessions`)).body.data).toHaveLength(1);
    void a;

    const history = await owner.get(`/users/${staff.id}/login-history?limit=1`);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.meta.nextCursor).toEqual(expect.any(String));
    const next = await owner.get(`/users/${staff.id}/login-history?limit=5&cursor=${history.body.meta.nextCursor}`);
    expect(next.body.data.length).toBeGreaterThanOrEqual(1);
    expect(next.body.data.some((e: any) => e.id === history.body.data[0].id)).toBe(false);
  });

  it("archiving removes the user from lists and blocks login", async () => {
    const created = await owner.post("/users", newUser());
    const id = created.body.data.id;
    expect((await owner.del(`/users/${id}`)).status).toBe(204);
    expect((await owner.get(`/users/${id}`)).status).toBe(404);
    expect((await login(app, created.body.data.email, "Plain-Passw0rd-12")).status).toBe(401);
  });
});

describe("authorization changes apply on the very next request", () => {
  it("removing a permission from a role denies the next call with the SAME token; re-adding restores it", async () => {
    const staff = await createStaff(fx, { permissions: ["users.view", "org.view"] });
    const s = await loginStaff(app, staff);
    const as = api(app, s.token);
    expect((await as.get("/users")).status).toBe(200);

    const putOff = await owner.put(`/roles/${staff.roleId}/permissions`, { permissions: ["org.view"] });
    expect(putOff.status).toBe(200);
    expect((await as.get("/users")).status).toBe(403); // same access token, no re-login
    expect((await as.get("/brands")).status).toBe(200);

    await owner.put(`/roles/${staff.roleId}/permissions`, { permissions: ["org.view", "users.view"] });
    expect((await as.get("/users")).status).toBe(200);
  });

  it("changing a user's role takes effect immediately", async () => {
    const staff = await createStaff(fx, { permissions: ["org.view"] });
    const s = await loginStaff(app, staff);
    const as = api(app, s.token);
    expect((await as.get("/roles")).status).toBe(403);
    const other = await createStaff(fx, { permissions: ["roles.view"] });
    expect((await owner.put(`/users/${staff.id}/roles`, { roleIds: [other.roleId] })).status).toBe(200);
    expect((await as.get("/roles")).status).toBe(200);
    expect((await as.get("/brands")).status).toBe(403);
  });
});

describe("privilege escalation is blocked", () => {
  it("you cannot assign a role holding permissions you do not have", async () => {
    // an HR-style user: may manage users, but only holds a few permissions
    const hr = await createStaff(fx, { permissions: ["users.view", "users.manage", "roles.view", "menu.view"], allLocations: true });
    const as = api(app, (await loginStaff(app, hr)).token);

    const toBM = await as.post("/users", newUser({ roleIds: [fx.roleIds["Branch Manager"]!] }));
    expect(toBM.status).toBe(403);
    expect(toBM.body.error.code).toBe("FORBIDDEN");

    const harmless = await createStaff(fx, { permissions: ["menu.view"] });
    const ok = await as.post("/users", newUser({ roleIds: [harmless.roleId] }));
    expect(ok.status).toBe(201);

    // and the same rule applies when changing roles of an existing user
    const target = await owner.post("/users", newUser());
    expect((await as.put(`/users/${target.body.data.id}/roles`, { roleIds: [fx.roleIds["Head Office Admin"]!] })).status).toBe(403);
  });

  it("only an owner can assign the Owner role or touch an owner", async () => {
    const hoAdmin = await createStaff(fx, { roleName: "Head Office Admin", allLocations: true });
    const as = api(app, (await loginStaff(app, hoAdmin)).token);
    expect((await as.post("/users", newUser({ roleIds: [fx.roleIds["Owner"]!], password: "Twelve-chars1" }))).status).toBe(403);

    const ownerUser = await owner.get(`/users/${fx.ownerUserId}`);
    expect(ownerUser.status).toBe(200);
    expect((await as.patch(`/users/${fx.ownerUserId}`, { name: "Hijacked" })).status).toBe(403);
    expect((await as.post(`/users/${fx.ownerUserId}/reset-password`, { password: "Hijack-Passw0rd-1" })).status).toBe(403);
    expect((await as.put(`/users/${fx.ownerUserId}/roles`, { roleIds: [fx.roleIds["Cashier"]!] })).status).toBe(403);
  });

  it("a role editor cannot grant permissions they do not hold, nor raise limits or discounts above their own", async () => {
    const editor = await createStaff(fx, { permissions: ["roles.view", "roles.manage", "menu.view"], maxDiscountPercent: 10, limits: { PKR: { void: 1000, refund: 1000, po: 1000, adjustment: 1000 } } });
    const as = api(app, (await loginStaff(app, editor)).token);
    const role = await as.post("/roles", { name: "Trainee", maxDiscountPercent: 5 });
    expect(role.status).toBe(201);
    const id = role.body.data.id;

    expect((await as.put(`/roles/${id}/permissions`, { permissions: ["menu.view"] })).status).toBe(200); // holds it
    const deny = await as.put(`/roles/${id}/permissions`, { permissions: ["menu.view", "orders.void"] });
    expect(deny.status).toBe(403);
    expect(deny.body.error.message).toMatch(/orders\.void/);

    expect((await as.patch(`/roles/${id}`, { maxDiscountPercent: 30 })).status).toBe(403);
    expect((await as.patch(`/roles/${id}`, { maxDiscountPercent: 10 })).status).toBe(200);
    expect((await as.post("/roles", { name: "Too generous", maxDiscountPercent: 50 })).status).toBe(403);

    const limits = (v: number) => ({ limits: [{ currencyCode: "PKR", voidLimitMinor: v, refundLimitMinor: 1, poApprovalLimitMinor: 1, adjustmentLimitMinor: 1 }] });
    expect((await as.put(`/roles/${id}/limits`, limits(5000))).status).toBe(403);
    expect((await as.put(`/roles/${id}/limits`, limits(1000))).status).toBe(200);
    // a currency the editor has no authority in cannot be granted either
    const usd = { limits: [{ currencyCode: "USD", voidLimitMinor: 1, refundLimitMinor: 1, poApprovalLimitMinor: 1, adjustmentLimitMinor: 1 }] };
    expect((await as.put(`/roles/${id}/limits`, usd)).status).toBe(403);
  });

  it("an editor without the owner flag cannot edit the Owner role", async () => {
    const hoAdmin = await createStaff(fx, { roleName: "Head Office Admin", allLocations: true });
    const as = api(app, (await loginStaff(app, hoAdmin)).token);
    expect((await as.patch(`/roles/${fx.roleIds["Owner"]}`, { name: "Not Owner" })).status).toBe(403);
    expect((await as.put(`/roles/${fx.roleIds["Owner"]}/permissions`, { permissions: ["menu.view"] })).status).toBe(403);
  });
});

describe("the last owner is protected", () => {
  it("cannot be disabled, archived, or stripped of the owner role while no other owner exists", async () => {
    expect((await owner.patch(`/users/${fx.ownerUserId}`, { status: "DISABLED" })).status).toBe(403); // not yourself
    // another owner, acting on the first, so the "not yourself" rule is out of the way
    const second = await owner.post("/users", newUser({ roleIds: [fx.roleIds["Owner"]!], allLocations: true, locationIds: [], password: "Second-Owner-Passw0rd" }));
    expect(second.status).toBe(201);
    const secondLogin = await login(app, second.body.data.email, "Second-Owner-Passw0rd");
    const asSecond = api(app, secondLogin.token);

    // two owners: demoting the first is fine
    expect((await asSecond.put(`/users/${fx.ownerUserId}/roles`, { roleIds: [fx.roleIds["Cashier"]!] })).status).toBe(200);
    // now the second owner is the LAST one: the first (now a cashier) cannot remove them, and they cannot remove themselves
    expect((await asSecond.put(`/users/${second.body.data.id}/roles`, { roleIds: [fx.roleIds["Cashier"]!] })).status).toBe(409);
    expect((await asSecond.del(`/users/${second.body.data.id}`)).status).toBe(403);
    // restore the original owner so later tests and cleanup behave
    expect((await asSecond.put(`/users/${fx.ownerUserId}/roles`, { roleIds: [fx.roleIds["Owner"]!] })).status).toBe(200);
  });
});

describe("roles", () => {
  it("creates a custom role, sets permissions and limits, and shows the matrix catalog", async () => {
    const role = await owner.post("/roles", { name: "Shift Lead", description: "Leads a shift", maxDiscountPercent: 12.5 });
    expect(role.status).toBe(201);
    expect(role.body.data).toMatchObject({ name: "Shift Lead", isSystem: false, isOwner: false, maxDiscountPercent: 12.5, permissions: [], userCount: 0 });
    const id = role.body.data.id;

    const perms = await owner.put(`/roles/${id}/permissions`, { permissions: ["orders.view", "orders.create", "orders.view"] });
    expect(perms.body.data.permissions).toEqual(["orders.create", "orders.view"]); // de-duplicated
    expect((await owner.put(`/roles/${id}/permissions`, { permissions: ["orders.explode"] })).status).toBe(422);

    const lim = await owner.put(`/roles/${id}/limits`, { limits: [{ currencyCode: "PKR", voidLimitMinor: 500000, refundLimitMinor: 600000, poApprovalLimitMinor: 0, adjustmentLimitMinor: 100 }, { currencyCode: "AED", voidLimitMinor: 7500, refundLimitMinor: 9000, poApprovalLimitMinor: 0, adjustmentLimitMinor: 50 }] });
    expect(lim.body.data.limits).toHaveLength(2);
    expect((await owner.put(`/roles/${id}/limits`, { limits: [{ currencyCode: "PKR", voidLimitMinor: 1, refundLimitMinor: 1, poApprovalLimitMinor: 1, adjustmentLimitMinor: 1 }, { currencyCode: "PKR", voidLimitMinor: 2, refundLimitMinor: 2, poApprovalLimitMinor: 2, adjustmentLimitMinor: 2 }] })).status).toBe(422);

    const catalog = await owner.get("/permissions");
    expect(catalog.body.data.map((g: any) => g.module)).toEqual(expect.arrayContaining(["Orders & POS", "Inventory", "Reports"]));

    const audit = await auditFor(fx.tenantId, "Role", id);
    expect(audit.map((r) => r.action)).toEqual(["roles.create", "roles.permissions.update", "roles.limits.update"]);
    expect((audit[1]!.after as any).added).toEqual(["orders.create", "orders.view"]);
  });

  it("protects owner roles and roles that are in use", async () => {
    expect((await owner.put(`/roles/${fx.roleIds["Owner"]}/permissions`, { permissions: ["menu.view"] })).status).toBe(409);
    expect((await owner.put(`/roles/${fx.roleIds["Owner"]}/limits`, { limits: [] })).status).toBe(409);
    expect((await owner.patch(`/roles/${fx.roleIds["Owner"]}`, { maxDiscountPercent: 10 })).status).toBe(409);
    expect((await owner.del(`/roles/${fx.roleIds["Owner"]}`)).status).toBe(409);
    expect((await owner.del(`/roles/${fx.roleIds["Cashier"]}`)).status).toBe(409); // assigned to users

    const spare = await owner.post("/roles", { name: "Spare" });
    expect((await owner.del(`/roles/${spare.body.data.id}`)).status).toBe(204);
    expect((await owner.get(`/roles/${spare.body.data.id}`)).status).toBe(404);
  });

  it("lists roles with permission and user counts", async () => {
    const res = await owner.get("/roles?pageSize=100");
    const cashier = res.body.data.find((r: any) => r.name === "Cashier");
    expect(cashier.userCount).toBeGreaterThan(0);
    expect(cashier.permissions).toContain("pos.access");
    expect(res.body.data.find((r: any) => r.name === "Owner").permissions.length).toBeGreaterThan(50);
  });

  it("role names are unique", async () => {
    expect((await owner.post("/roles", { name: "Duplicate Role" })).status).toBe(201);
    expect((await owner.post("/roles", { name: "duplicate role" })).status).toBe(409);
  });
});
