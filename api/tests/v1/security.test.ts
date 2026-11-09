import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { runAsTenant } from "../../src/core/context/context.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { db } from "../../src/core/db/scoped.js";
import { routeRegistry, type RouteInfo } from "../../src/core/http/secured.js";
import { notify } from "../../src/core/notifications/notify.js";
import { bearer, createBaseOrg, createFixture, createStaff, loginOwner, loginStaff, type Fixture } from "../helpers/fixtures.js";
import { api } from "../helpers/http.js";

const app = createApp(); // importing the app registers every route in routeRegistry

// The ONLY routes allowed without a login. Adding a public route must be a conscious change to this list.
const EXPECTED_PUBLIC = ["GET /api/v1/health", "POST /api/v1/auth/login", "POST /api/v1/auth/logout", "POST /api/v1/auth/refresh"];

/** Run async work in small concurrent batches: the database is remote, so parallel calls cut wall time a lot. */
async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

const concretePath = (route: RouteInfo) => route.path.replace(/:\w+/g, () => crypto.randomUUID());
const call = (route: RouteInfo, token?: string) => {
  const req = request(app)[route.method](concretePath(route));
  if (token) req.set(bearer(token));
  return route.method === "get" || route.method === "delete" ? req : req.send({});
};

describe("route registry", () => {
  it("covers the whole API and every route declares its access", () => {
    expect(routeRegistry.length).toBeGreaterThan(80);
    for (const r of routeRegistry) {
      expect(r.path.startsWith("/api/v1/"), r.path).toBe(true);
      expect(r.access, `${r.method} ${r.path}`).toBeTruthy();
    }
    const seen = new Set(routeRegistry.map((r) => `${r.method} ${r.path}`));
    expect(seen.size).toBe(routeRegistry.length); // no route declared twice
  });

  it("the set of public (no login) routes is exactly the expected one", () => {
    const pub = routeRegistry.filter((r) => r.access === "public").map((r) => `${r.method.toUpperCase()} ${r.path}`).sort();
    expect(pub).toEqual([...EXPECTED_PUBLIC].sort());
  });

  it("every other route needs a login", () => {
    const gated = routeRegistry.filter((r) => r.access !== "public");
    expect(gated.length).toBeGreaterThan(70);
  });
});

describe("permission matrix (generated from the route registry)", () => {
  let fx: Fixture;
  let ownerToken: string;
  let nobodyToken: string;

  beforeAll(async () => {
    fx = await createFixture();
    ownerToken = (await loginOwner(app, fx)).token;
    nobodyToken = (await loginStaff(app, await createStaff(fx, { permissions: [] }))).token; // a role with ZERO permissions
  });
  afterAll(async () => {
    await fx.cleanup();
    await unscopedDb.$disconnect();
  });

  it("anonymous callers get 401 on every non-public route", async () => {
    const gated = routeRegistry.filter((r) => r.access !== "public");
    await inBatches(gated, 10, async (route) => {
      const res = await call(route);
      expect(res.status, `${route.method.toUpperCase()} ${route.path}`).toBe(401);
    });
  });

  it("a user holding NO permissions gets 403 on every permission-gated route", async () => {
    const gated = routeRegistry.filter((r) => r.access !== "public" && r.access !== "authenticated");
    expect(gated.length).toBeGreaterThan(60);
    await inBatches(gated, 8, async (route) => {
      const res = await call(route, nobodyToken);
      expect(res.status, `${route.method.toUpperCase()} ${route.path} (needs ${JSON.stringify(route.access)})`).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });
  });

  it("login-only routes work for a user with no permissions (they are about the user's own data)", async () => {
    const own = routeRegistry.filter((r) => r.access === "authenticated" && r.method === "get");
    expect(own.length).toBeGreaterThan(1);
    for (const route of own) {
      const res = await call(route, nobodyToken);
      expect([401, 403], `${route.method.toUpperCase()} ${route.path}`).not.toContain(res.status);
    }
  });

  it("the owner (all permissions) is never blocked by a gate (business outcomes like 404/422 are fine)", { timeout: 600_000 }, async () => {
    const gated = routeRegistry.filter((r) => r.access !== "public");
    await inBatches(gated, 6, async (route) => {
      const res = await call(route, ownerToken);
      expect([401, 403], `${route.method.toUpperCase()} ${route.path} -> ${res.status} ${JSON.stringify(res.body?.error)}`).not.toContain(res.status);
    });
  });
});

describe("tenant isolation: tenant B can never see or touch tenant A's data", () => {
  let a: Fixture;
  let b: Fixture;
  let asB: ReturnType<typeof api>;
  const A: Record<string, string> = {};
  let baseB: Awaited<ReturnType<typeof createBaseOrg>>;

  beforeAll(async () => {
    a = await createFixture();
    b = await createFixture();
    const asA = api(app, (await loginOwner(app, a)).token);
    asB = api(app, (await loginOwner(app, b)).token);

    baseB = await createBaseOrg(b);
    const base = await createBaseOrg(a);
    A.brand = base.brandId;
    A.taxProfile = base.taxProfileId;
    A.priceBook = base.priceBookId;
    A.taxCategory = (await asA.post("/tax-categories", { name: "A category" })).body.data.id;
    A.paymentMethod = (await asA.post("/payment-methods", { name: "A wallet", type: "WALLET" })).body.data.id;
    const loc = await asA.post("/locations", { type: "BRANCH", brandId: base.brandId, code: "A-1", name: "A Branch", countryCode: "PK", timezone: "Asia/Karachi", currencyCode: "PKR", taxProfileId: base.taxProfileId, priceBookId: base.priceBookId });
    A.location = loc.body.data.id;
    A.table = (await asA.post("/dining-tables", { locationId: A.location, name: "A-T1" })).body.data.id;
    A.station = (await asA.post("/kitchen-stations", { locationId: A.location, key: "GRILL", name: "A Grill" })).body.data.id;
    A.role = (await asA.post("/roles", { name: "A custom role" })).body.data.id;
    A.user = (await asA.post("/users", { name: "A Person", email: `a-person@${a.slug}.test`, password: "Plain-Passw0rd-12", roleIds: [a.roleIds["Cashier"]!], locationIds: [A.location] })).body.data.id;

    // an approval request and a notification in A (written directly: they are normally created by domain services)
    A.approval = (
      await unscopedDb.approvalRequest.create({
        data: { tenantId: a.tenantId, type: "VOID", entityType: "Order", payload: {}, payloadHash: "hash-a-0001", amountMinor: 100, currencyCode: "PKR", reason: "test", requestedById: A.user!, expiresAt: new Date(Date.now() + 3_600_000) },
      })
    ).id;
    await runAsTenant(a.tenantId, () => notify(db, { type: "TEST", title: "A only", requiredPermission: "approvals.view", dedupeKey: "a-only" }));
    A.notification = (await unscopedDb.notification.findFirstOrThrow({ where: { tenantId: a.tenantId, dedupeKey: "a-only" } })).id;
  });
  afterAll(async () => {
    await a.cleanup();
    await b.cleanup();
    await unscopedDb.$disconnect();
  });

  const LISTS = ["/brands", "/locations", "/tax-categories", "/tax-profiles", "/payment-methods", "/price-books", "/dining-tables", "/kitchen-stations", "/users", "/roles", "/approvals", "/audit-logs", "/notifications", "/reason-codes"];

  it("never returns any of A's records in B's lists", { timeout: 600_000 }, async () => {
    const idsOfA = Object.values(A);
    for (const path of LISTS) {
      const res = await asB.get(`${path}${path === "/audit-logs" || path === "/notifications" ? "" : "?pageSize=100"}`);
      expect(res.status, path).toBe(200);
      const body = JSON.stringify(res.body);
      for (const id of idsOfA) expect(body.includes(id), `${path} leaked ${id}`).toBe(false);
    }
  });

  it("B's lists contain only B's own tenant id", async () => {
    for (const path of ["/brands", "/roles", "/payment-methods", "/users"]) {
      const res = await asB.get(`${path}?pageSize=100`);
      expect(res.body.data.length, path).toBeGreaterThan(0);
      if (res.body.data[0].tenantId) for (const row of res.body.data) expect(row.tenantId, path).toBe(b.tenantId);
    }
    expect(JSON.stringify((await asB.get("/audit-logs?limit=100")).body)).not.toContain(a.tenantId);
  });

  it("answers 404 (not 403) for A's ids on every read", async () => {
    const detail: [string, string][] = [
      ["/brands", A.brand!], ["/locations", A.location!], ["/tax-categories", A.taxCategory!], ["/tax-profiles", A.taxProfile!],
      ["/payment-methods", A.paymentMethod!], ["/price-books", A.priceBook!], ["/dining-tables", A.table!], ["/kitchen-stations", A.station!],
      ["/users", A.user!], ["/roles", A.role!], ["/approvals", A.approval!],
    ];
    for (const [path, id] of detail) expect((await asB.get(`${path}/${id}`)).status, `GET ${path}/${id}`).toBe(404);
    expect((await asB.get(`/locations/${A.location}/opening-hours`)).status).toBe(404);
    expect((await asB.get(`/locations/${A.location}/payment-methods`)).status).toBe(404);
    expect((await asB.get(`/users/${A.user}/sessions`)).status).toBe(404);
    expect((await asB.get(`/users/${A.user}/login-history`)).status).toBe(404);
  });

  it("answers 404 for A's ids on every write", { timeout: 600_000 }, async () => {
    expect((await asB.patch(`/brands/${A.brand}`, { name: "hijack" })).status).toBe(404);
    expect((await asB.del(`/brands/${A.brand}`)).status).toBe(404);
    expect((await asB.post(`/brands/${A.brand}/restore`)).status).toBe(404);
    expect((await asB.patch(`/locations/${A.location}`, { name: "hijack" })).status).toBe(404);
    expect((await asB.put(`/locations/${A.location}/opening-hours`, { hours: [] })).status).toBe(404);
    expect((await asB.put(`/locations/${A.location}/payment-methods`, { methods: [] })).status).toBe(404);
    expect((await asB.put(`/tax-profiles/${A.taxProfile}/rules`, { rules: [] })).status).toBe(404);
    expect((await asB.patch(`/roles/${A.role}`, { name: "hijack" })).status).toBe(404);
    expect((await asB.put(`/roles/${A.role}/permissions`, { permissions: [] })).status).toBe(404);
    expect((await asB.put(`/roles/${A.role}/limits`, { limits: [] })).status).toBe(404);
    expect((await asB.del(`/roles/${A.role}`)).status).toBe(404);
    expect((await asB.patch(`/users/${A.user}`, { status: "DISABLED" })).status).toBe(404);
    expect((await asB.put(`/users/${A.user}/roles`, { roleIds: [b.roleIds["Owner"]!] })).status).toBe(404);
    expect((await asB.post(`/users/${A.user}/reset-password`, { password: "Hijack-Passw0rd-1" })).status).toBe(404);
    expect((await asB.put(`/users/${A.user}/pin`, { pin: "1234" })).status).toBe(404);
    expect((await asB.del(`/users/${A.user}`)).status).toBe(404);
    expect((await asB.post(`/approvals/${A.approval}/decision`, { decision: "APPROVE" })).status).toBe(404);
    expect((await asB.post(`/notifications/${A.notification}/read`)).status).toBe(404);
  });

  it("A's data is unchanged after all of that", async () => {
    expect((await unscopedDb.brand.findUniqueOrThrow({ where: { id: A.brand! } })).deletedAt).toBeNull();
    expect((await unscopedDb.user.findUniqueOrThrow({ where: { id: A.user! } })).status).toBe("ACTIVE");
    expect((await unscopedDb.approvalRequest.findUniqueOrThrow({ where: { id: A.approval! } })).status).toBe("PENDING");
  });

  it("B cannot reference A's records when creating or linking its own", { timeout: 600_000 }, async () => {
    const locBody = { type: "BRANCH", code: "B-1", name: "B Branch", countryCode: "PK", timezone: "Asia/Karachi", currencyCode: "PKR" };
    expect((await asB.post("/locations", { ...locBody, brandId: A.brand, taxProfileId: baseB.taxProfileId, priceBookId: baseB.priceBookId })).status).toBe(422);
    expect((await asB.post("/locations", { ...locBody, brandId: baseB.brandId, taxProfileId: A.taxProfile, priceBookId: baseB.priceBookId })).status).toBe(422);
    expect((await asB.post("/locations", { ...locBody, brandId: baseB.brandId, taxProfileId: baseB.taxProfileId, priceBookId: A.priceBook })).status).toBe(422);

    const ok = await asB.post("/locations", { ...locBody, brandId: baseB.brandId, taxProfileId: baseB.taxProfileId, priceBookId: baseB.priceBookId });
    expect(ok.status).toBe(201);
    const bLoc = ok.body.data.id;
    expect((await asB.post("/dining-tables", { locationId: A.location, name: "x" })).status).toBe(422);
    expect((await asB.post("/kitchen-stations", { locationId: A.location, key: "X1", name: "x" })).status).toBe(422);
    expect((await asB.put(`/locations/${bLoc}/payment-methods`, { methods: [{ paymentMethodId: A.paymentMethod, isEnabled: true }] })).status).toBe(422);
    expect((await asB.put(`/tax-profiles/${baseB.taxProfileId}/rules`, { rules: [{ taxCategoryId: A.taxCategory, name: "x", authorityCode: "x", ratePercent: 1 }] })).status).toBe(422);

    const bUser = await asB.post("/users", { name: "B Person", email: `b-person@${b.slug}.test`, password: "Plain-Passw0rd-12", roleIds: [b.roleIds["Cashier"]!], locationIds: [bLoc] });
    expect(bUser.status).toBe(201);
    expect((await asB.post("/users", { name: "Sneaky", email: `sneaky@${b.slug}.test`, password: "Plain-Passw0rd-12", roleIds: [a.roleIds["Cashier"]!], locationIds: [] })).status).toBe(422);
    expect((await asB.post("/users", { name: "Sneaky2", email: `sneaky2@${b.slug}.test`, password: "Plain-Passw0rd-12", roleIds: [b.roleIds["Cashier"]!], locationIds: [A.location] })).status).toBe(422);
    expect((await asB.put(`/users/${bUser.body.data.id}/roles`, { roleIds: [a.roleIds["Owner"]!] })).status).toBe(422);
    expect((await asB.put(`/users/${bUser.body.data.id}/locations`, { allLocations: false, locationIds: [A.location] })).status).toBe(422);
  });

  it("the database itself refuses a cross-tenant link (composite foreign keys)", async () => {
    await expect(unscopedDb.userRole.create({ data: { tenantId: b.tenantId, userId: A.user!, roleId: b.roleIds["Cashier"]! } })).rejects.toThrow();
    await expect(unscopedDb.userLocation.create({ data: { tenantId: b.tenantId, userId: b.ownerUserId, locationId: A.location! } })).rejects.toThrow();
    await expect(unscopedDb.diningTable.create({ data: { tenantId: b.tenantId, locationId: A.location!, name: "evil" } })).rejects.toThrow();
  });
});
