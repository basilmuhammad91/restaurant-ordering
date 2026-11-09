import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { runAsTenant } from "../../src/core/context/context.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { db } from "../../src/core/db/scoped.js";
import { notify } from "../../src/core/notifications/notify.js";
import { createBaseOrg, createFixture, createLocation, createStaff, loginOwner, loginStaff, type BaseOrg, type Fixture } from "../helpers/fixtures.js";
import { api } from "../helpers/http.js";

// A user limited to branch 1 must never see or change anything that belongs to branch 2 or to the whole company.

const app = createApp();
let fx: Fixture;
let owner: ReturnType<typeof api>;
let base: BaseOrg;
let L1: string;
let L2: string;
let limited: ReturnType<typeof api>;
let limitedMe: any;
let u1: string; // user at L1
let u2: string; // user at L2
let uAll: string; // user with access to everything

beforeAll(async () => {
  fx = await createFixture();
  owner = api(app, (await loginOwner(app, fx)).token);
  base = await createBaseOrg(fx);
  L1 = (await createLocation(fx, base, "SC-1")).id;
  L2 = (await createLocation(fx, base, "SC-2")).id;

  const staff = await createStaff(fx, {
    permissions: ["org.view", "locations.manage", "users.view", "users.manage", "roles.view", "audit.view", "approvals.view", "menu.view"],
    locationIds: [L1],
  });
  const s = await loginStaff(app, staff);
  limited = api(app, s.token);
  limitedMe = s.me;

  const mk = async (email: string, locationIds: string[], allLocations = false) =>
    (await owner.post("/users", { name: email, email: `${email}@${fx.slug}.test`, password: "Plain-Passw0rd-12", roleIds: [fx.roleIds["Cashier"]!], allLocations, locationIds })).body.data.id as string;
  u1 = await mk("u-one", [L1]);
  u2 = await mk("u-two", [L2]);
  uAll = await mk("u-all", [], true);

  await owner.post("/dining-tables", { locationId: L1, name: "L1-T1" });
  await owner.post("/dining-tables", { locationId: L2, name: "L2-T1" });
  await owner.post("/kitchen-stations", { locationId: L1, key: "GRILL", name: "L1 grill" });
  await owner.post("/kitchen-stations", { locationId: L2, key: "GRILL", name: "L2 grill" });
});
afterAll(async () => {
  await fx.cleanup();
  await unscopedDb.$disconnect();
});

describe("a branch-limited user only sees their own branches", () => {
  it("/auth/me lists only the allowed branches", () => {
    expect(limitedMe.allLocations).toBe(false);
    expect(limitedMe.locations.map((l: any) => l.id)).toEqual([L1]);
  });

  it("locations: lists only theirs; others are 404; cannot edit or archive them; cannot create locations", async () => {
    const list = await limited.get("/locations?pageSize=100");
    expect(list.body.data.map((l: any) => l.id)).toEqual([L1]);
    expect((await limited.get(`/locations/${L1}`)).status).toBe(200);
    expect((await limited.get(`/locations/${L2}`)).status).toBe(404);
    expect((await limited.patch(`/locations/${L2}`, { name: "hijack" })).status).toBe(404);
    expect((await limited.del(`/locations/${L2}`)).status).toBe(404);
    expect((await limited.put(`/locations/${L2}/opening-hours`, { hours: [] })).status).toBe(404);
    expect((await limited.patch(`/locations/${L1}`, { name: "Allowed rename" })).status).toBe(200);

    const create = await limited.post("/locations", { type: "WAREHOUSE", code: "NEW-WH", name: "New", countryCode: "PK", timezone: "Asia/Karachi", currencyCode: "PKR" });
    expect(create.status).toBe(403);
  });

  it("tables and stations: lists are filtered; cannot create in another branch", async () => {
    const tables = await limited.get("/dining-tables?pageSize=100");
    expect(tables.body.data.map((t: any) => t.name)).toEqual(["L1-T1"]);
    const stations = await limited.get("/kitchen-stations");
    expect(stations.body.data.map((s: any) => s.name)).toEqual(["L1 grill"]);

    const other = await limited.post("/dining-tables", { locationId: L2, name: "sneak" });
    expect([403, 422]).toContain(other.status);
    expect((await limited.post("/dining-tables", { locationId: L1, name: "L1-T2" })).status).toBe(201);
  });

  it("users: sees only people assigned to their branches (not other branches, not all-branch staff)", async () => {
    const list = await limited.get("/users?pageSize=100");
    const ids = list.body.data.map((u: any) => u.id);
    expect(ids).toContain(u1);
    expect(ids).not.toContain(u2);
    expect(ids).not.toContain(uAll);
    expect((await limited.get(`/users/${u2}`)).status).toBe(404);
    expect((await limited.get(`/users/${uAll}`)).status).toBe(404);
    expect((await limited.patch(`/users/${u2}`, { name: "x" })).status).toBe(404);
    expect((await limited.patch(`/users/${u1}`, { name: "Renamed by branch admin" })).status).toBe(200);
  });

  it("cannot assign branches they do not have, nor 'all branches'", async () => {
    expect((await limited.put(`/users/${u1}/locations`, { allLocations: false, locationIds: [L2] })).status).toBe(403);
    expect((await limited.put(`/users/${u1}/locations`, { allLocations: false, locationIds: [L1, L2] })).status).toBe(403);
    expect((await limited.put(`/users/${u1}/locations`, { allLocations: true, locationIds: [] })).status).toBe(403);
    expect((await limited.put(`/users/${u1}/locations`, { allLocations: false, locationIds: [L1] })).status).toBe(200);
    const create = await limited.post("/users", { name: "Wide", email: `wide@${fx.slug}.test`, password: "Plain-Passw0rd-12", roleIds: [fx.roleIds["Cashier"]!], allLocations: true });
    expect(create.status).toBe(403);
  });

  it("audit log: only entries of their branches, never company-wide changes or other branches", async () => {
    // owner changes things at L2, at L1, and company-wide
    await owner.patch(`/locations/${L2}`, { name: "L2 renamed" });
    await owner.patch(`/locations/${L1}`, { name: "L1 renamed by owner" });
    await owner.patch("/tenant", { name: "Company-wide rename" });

    const ownerView = await owner.get("/audit-logs?limit=100");
    const limitedView = await limited.get("/audit-logs?limit=100");
    expect(ownerView.body.data.some((r: any) => r.action === "tenant.update")).toBe(true);
    expect(limitedView.body.data.length).toBeGreaterThan(0);
    expect(limitedView.body.data.every((r: any) => r.locationId === L1)).toBe(true);
    expect(limitedView.body.data.some((r: any) => r.action === "tenant.update")).toBe(false);
    expect(limitedView.body.data.some((r: any) => r.entityId === L2)).toBe(false);
    // filtering by someone else's branch returns nothing rather than leaking
    expect((await limited.get(`/audit-logs?locationId=${L2}`)).body.data).toHaveLength(0);
  });

  it("approvals and notifications: branch items are scoped, company-wide ones stay visible", async () => {
    const mkApproval = (locationId: string | null, hash: string) =>
      unscopedDb.approvalRequest.create({
        data: { tenantId: fx.tenantId, locationId, type: "VOID", entityType: "Order", payload: {}, payloadHash: hash, reason: "scope test", requestedById: u1, expiresAt: new Date(Date.now() + 3_600_000) },
      });
    const a1 = await mkApproval(L1, "scope-hash-1");
    const a2 = await mkApproval(L2, "scope-hash-2");
    const aCo = await mkApproval(null, "scope-hash-3");

    const list = await limited.get("/approvals?pageSize=100");
    const ids = list.body.data.map((a: any) => a.id);
    expect(ids).toEqual(expect.arrayContaining([a1.id, aCo.id]));
    expect(ids).not.toContain(a2.id);
    expect((await limited.get(`/approvals/${a2.id}`)).status).toBe(404);

    await runAsTenant(fx.tenantId, async () => {
      await notify(db, { type: "T", title: "L1 note", requiredPermission: "approvals.view", locationId: L1, dedupeKey: "n-l1" });
      await notify(db, { type: "T", title: "L2 note", requiredPermission: "approvals.view", locationId: L2, dedupeKey: "n-l2" });
      await notify(db, { type: "T", title: "Company note", requiredPermission: "approvals.view", dedupeKey: "n-co" });
    });
    const titles = (await limited.get("/notifications?limit=100")).body.data.map((n: any) => n.title);
    expect(titles).toEqual(expect.arrayContaining(["L1 note", "Company note"]));
    expect(titles).not.toContain("L2 note");
  });

  it("the owner (all branches) still sees everything", async () => {
    expect((await owner.get("/locations?pageSize=100")).body.data.map((l: any) => l.id)).toEqual(expect.arrayContaining([L1, L2]));
    expect((await owner.get("/users?pageSize=100")).body.data.map((u: any) => u.id)).toEqual(expect.arrayContaining([u1, u2, uAll]));
    expect((await owner.get("/dining-tables?pageSize=100")).body.data.length).toBeGreaterThanOrEqual(3);
  });
});
