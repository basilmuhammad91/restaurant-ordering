import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { createBaseOrg, createFixture, loginOwner, type BaseOrg, type Fixture } from "../helpers/fixtures.js";
import { api, auditFor } from "../helpers/http.js";

const app = createApp();
let fx: Fixture;
let owner: ReturnType<typeof api>;
let base: BaseOrg;

beforeAll(async () => {
  fx = await createFixture();
  owner = api(app, (await loginOwner(app, fx)).token);
  base = await createBaseOrg(fx);
});
afterAll(async () => {
  await fx.cleanup();
  await unscopedDb.$disconnect();
});

describe("brands: CRUD, search, sort, pagination", () => {
  const ids: string[] = [];

  it("creates brands and returns the data envelope", async () => {
    for (const [name, slug] of [["Zeta Grill", "zeta-grill"], ["Alpha Burgers", "alpha-burgers"], ["Mid Cafe", "mid-cafe"]]) {
      const res = await owner.post("/brands", { name, slug, cuisine: "Mixed" });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ name, slug, isActive: true, tenantId: fx.tenantId });
      ids.push(res.body.data.id);
    }
  });

  it("lists with offset pagination meta", async () => {
    const res = await owner.get("/brands?pageSize=2&page=1&sort=name");
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 2 });
    expect(res.body.meta.total).toBeGreaterThanOrEqual(4); // 3 here + the base brand
    expect(res.body.data).toHaveLength(2);
    const page2 = await owner.get("/brands?pageSize=2&page=2&sort=name");
    expect(page2.body.data[0].id).not.toBe(res.body.data[0].id);
  });

  it("sorts ascending and descending, and rejects non-whitelisted sort fields", async () => {
    const asc = (await owner.get("/brands?sort=name")).body.data.map((b: any) => b.name);
    expect(asc).toEqual([...asc].sort((a: string, b: string) => a.localeCompare(b)));
    const desc = (await owner.get("/brands?sort=-name")).body.data.map((b: any) => b.name);
    expect(desc).toEqual([...asc].reverse());
    const bad = await owner.get("/brands?sort=tenantId");
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("searches case-insensitively across name, slug and cuisine", async () => {
    const res = await owner.get("/brands?q=ALPHA");
    expect(res.body.data.map((b: any) => b.slug)).toEqual(["alpha-burgers"]);
  });

  it("filters", async () => {
    await owner.patch(`/brands/${ids[0]}`, { isActive: false });
    const inactive = await owner.get("/brands?isActive=false");
    expect(inactive.body.data.map((b: any) => b.id)).toEqual([ids[0]]);
  });

  it("validates input and enforces unique slugs", async () => {
    const bad = await owner.post("/brands", { name: "", slug: "Bad Slug!" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.fieldErrors).toHaveProperty("name");
    expect(bad.body.error.details.fieldErrors).toHaveProperty("slug");
    const dup = await owner.post("/brands", { name: "Another", slug: "mid-cafe" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("CONFLICT");
  });

  it("returns 404 for an unknown id and 422 for a malformed one", async () => {
    expect((await owner.get(`/brands/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await owner.get("/brands/not-a-uuid")).status).toBe(422);
  });
});

describe("soft delete (archive and restore)", () => {
  it("archives: hidden by default, visible with includeArchived, restorable", async () => {
    const created = await owner.post("/brands", { name: "Ghost Kitchen", slug: "ghost-kitchen" });
    const id = created.body.data.id;

    expect((await owner.del(`/brands/${id}`)).status).toBe(204);
    expect((await owner.get(`/brands/${id}`)).status).toBe(404);
    expect((await owner.get("/brands?q=ghost")).body.data).toHaveLength(0);
    const withArchived = await owner.get("/brands?q=ghost&includeArchived=true");
    expect(withArchived.body.data).toHaveLength(1);
    expect(withArchived.body.data[0].deletedAt).toEqual(expect.any(String));

    const restored = await owner.post(`/brands/${id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.data.deletedAt).toBeNull();
    expect((await owner.get(`/brands/${id}`)).status).toBe(200);
  });

  it("a name can be reused after archiving (uniqueness only applies to live rows)", async () => {
    const a = await owner.post("/tax-categories", { name: "Reusable" });
    expect(a.status).toBe(201);
    expect((await owner.post("/tax-categories", { name: "reusable" })).status).toBe(409); // case-insensitive, still live
    expect((await owner.del(`/tax-categories/${a.body.data.id}`)).status).toBe(204);
    expect((await owner.post("/tax-categories", { name: "Reusable" })).status).toBe(201);
  });

  it("cannot restore something that is not archived", async () => {
    const live = await owner.post("/tax-categories", { name: "Still live" });
    expect((await owner.post(`/tax-categories/${live.body.data.id}/restore`)).status).toBe(404);
  });
});

describe("audit trail for master-data changes", () => {
  it("records create, update (with before/after) and archive, attributed to the actor", async () => {
    const created = await owner.post("/brands", { name: "Audited", slug: "audited-brand" });
    const id = created.body.data.id;
    await owner.patch(`/brands/${id}`, { name: "Audited Renamed" });
    await owner.del(`/brands/${id}`);

    const rows = await auditFor(fx.tenantId, "Brand", id);
    expect(rows.map((r) => r.action)).toEqual(["brands.create", "brands.update", "brands.archive"]);
    expect(rows.every((r) => r.actorUserId === fx.ownerUserId && r.actorType === "USER")).toBe(true);
    expect((rows[1]!.before as any).name).toBe("Audited");
    expect((rows[1]!.after as any).name).toBe("Audited Renamed");
    expect(rows.every((r) => !!r.requestId)).toBe(true);
  });
});

describe("locations", () => {
  const body = (over: object = {}) => ({
    type: "BRANCH", brandId: base.brandId, code: "br-1", name: "Branch One", countryCode: "PK", timezone: "Asia/Karachi",
    currencyCode: "PKR", taxProfileId: base.taxProfileId, priceBookId: base.priceBookId, ...over,
  });

  it("creates a branch (code upper-cased) and defaults the business day start", async () => {
    const res = await owner.post("/locations", body());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code: "BR-1", businessDayStartTime: "05:00", currencyCode: "PKR", brand: { id: base.brandId } });
  });

  it("a branch needs a brand, a tax profile and a price book", async () => {
    for (const missing of ["brandId", "taxProfileId", "priceBookId"]) {
      const res = await owner.post("/locations", body({ code: `m-${missing}`.slice(0, 12), [missing]: null }));
      expect(res.status, missing).toBe(422);
      expect(res.body.error.details.fieldErrors).toHaveProperty(missing);
    }
  });

  it("the price book currency must match the location currency", async () => {
    const res = await owner.post("/locations", body({ code: "mismatch", currencyCode: "AED" }));
    expect(res.status).toBe(422);
    expect(res.body.error.details.fieldErrors).toHaveProperty("priceBookId");
  });

  it("validates currency, timezone and country", async () => {
    expect((await owner.post("/locations", body({ code: "tz", timezone: "Mars/Olympus" }))).status).toBe(422);
    expect((await owner.post("/locations", body({ code: "cur", currencyCode: "pkr" }))).status).toBe(422);
    expect((await owner.post("/locations", body({ code: "cc", countryCode: "Pakistan" }))).status).toBe(422);
    const unknown = await owner.post("/locations", body({ code: "xxx", currencyCode: "XXX" }));
    expect(unknown.status).toBe(422);
  });

  it("a warehouse needs no brand; location codes are unique, and reusable after archiving", async () => {
    const wh = await owner.post("/locations", { type: "WAREHOUSE", code: "wh-1", name: "Warehouse", countryCode: "PK", timezone: "Asia/Karachi", currencyCode: "PKR" });
    expect(wh.status).toBe(201);
    expect((await owner.post("/locations", { type: "WAREHOUSE", code: "WH-1", name: "Dup", countryCode: "PK", timezone: "Asia/Karachi", currencyCode: "PKR" })).status).toBe(409);
    await owner.del(`/locations/${wh.body.data.id}`);
    expect((await owner.post("/locations", { type: "WAREHOUSE", code: "WH-1", name: "Again", countryCode: "PK", timezone: "Asia/Karachi", currencyCode: "PKR" })).status).toBe(201);
  });

  it("logs currency/timezone/tax changes under their own audit action", async () => {
    const created = await owner.post("/locations", body({ code: "audit-loc" }));
    const id = created.body.data.id;
    await owner.patch(`/locations/${id}`, { name: "Renamed only" });
    await owner.patch(`/locations/${id}`, { timezone: "Asia/Dubai" });
    const actions = (await auditFor(fx.tenantId, "Location", id)).map((r) => r.action);
    expect(actions).toEqual(["locations.create", "locations.update", "locations.settings.update"]);
  });

  it("opening hours: replace the whole week, read it back, reject duplicates", async () => {
    const loc = await owner.post("/locations", body({ code: "hours" }));
    const id = loc.body.data.id;
    const put = await owner.put(`/locations/${id}/opening-hours`, {
      hours: [
        { weekday: 1, opensAt: "11:00", closesAt: "02:00" },
        { weekday: 1, opensAt: "05:00", closesAt: "09:00" }, // a second range on the same day (breakfast)
        { weekday: 2, opensAt: "11:00", closesAt: "23:00" },
      ],
    });
    expect(put.status).toBe(200);
    const get = await owner.get(`/locations/${id}/opening-hours`);
    expect(get.body.data.map((h: any) => `${h.weekday}:${h.opensAt}`)).toEqual(["1:05:00", "1:11:00", "2:11:00"]);

    const dup = await owner.put(`/locations/${id}/opening-hours`, { hours: [{ weekday: 1, opensAt: "11:00", closesAt: "12:00" }, { weekday: 1, opensAt: "11:00", closesAt: "13:00" }] });
    expect(dup.status).toBe(422);
    expect((await owner.put(`/locations/${id}/opening-hours`, { hours: [{ weekday: 9, opensAt: "11:00", closesAt: "12:00" }] })).status).toBe(422);
    expect((await owner.put(`/locations/${id}/opening-hours`, { hours: [] })).status).toBe(200); // clearing is allowed
    expect((await auditFor(fx.tenantId, "Location", id)).map((r) => r.action)).toContain("locations.opening-hours.update");
  });

  it("per-branch payment methods", async () => {
    const loc = await owner.post("/locations", body({ code: "pay" }));
    const methods = (await owner.get("/payment-methods?pageSize=100")).body.data;
    const cash = methods.find((m: any) => m.type === "CASH");
    const card = methods.find((m: any) => m.type === "CARD");
    const put = await owner.put(`/locations/${loc.body.data.id}/payment-methods`, {
      methods: [{ paymentMethodId: cash.id, isEnabled: true, sortOrder: 0 }, { paymentMethodId: card.id, isEnabled: false, sortOrder: 1 }],
    });
    expect(put.status).toBe(200);
    expect(put.body.data.map((m: any) => m.isEnabled)).toEqual([true, false]);
    expect((await owner.put(`/locations/${loc.body.data.id}/payment-methods`, { methods: [{ paymentMethodId: crypto.randomUUID(), isEnabled: true }] })).status).toBe(422);
  });

  it("filters by type and brand", async () => {
    const res = await owner.get("/locations?type=WAREHOUSE");
    expect(res.body.data.every((l: any) => l.type === "WAREHOUSE")).toBe(true);
  });
});

describe("tables and stations", () => {
  it("only branches have tables and stations", async () => {
    const wh = await owner.post("/locations", { type: "WAREHOUSE", code: "wh-tab", name: "WH", countryCode: "PK", timezone: "Asia/Karachi", currencyCode: "PKR" });
    const res = await owner.post("/dining-tables", { locationId: wh.body.data.id, name: "T1" });
    expect(res.status).toBe(422);
    const st = await owner.post("/kitchen-stations", { locationId: wh.body.data.id, key: "grill", name: "Grill" });
    expect(st.status).toBe(422);
  });

  it("creates, lists by branch, rejects duplicate names, and removes stations for good", async () => {
    const br = await owner.post("/locations", { type: "BRANCH", brandId: base.brandId, code: "tab-br", name: "Tab Branch", countryCode: "PK", timezone: "Asia/Karachi", currencyCode: "PKR", taxProfileId: base.taxProfileId, priceBookId: base.priceBookId });
    const locationId = br.body.data.id;
    expect((await owner.post("/dining-tables", { locationId, name: "T1", seats: 2, section: "Window" })).status).toBe(201);
    expect((await owner.post("/dining-tables", { locationId, name: "t1" })).status).toBe(409);
    expect((await owner.get(`/dining-tables?locationId=${locationId}`)).body.data).toHaveLength(1);

    const station = await owner.post("/kitchen-stations", { locationId, key: "grill", name: "Grill" });
    expect(station.status).toBe(201);
    expect(station.body.data.key).toBe("GRILL"); // normalised
    expect((await owner.post("/kitchen-stations", { locationId, key: "GRILL", name: "Dup" })).status).toBe(409);
    expect((await owner.del(`/kitchen-stations/${station.body.data.id}`)).status).toBe(204);
    expect((await owner.get(`/kitchen-stations?locationId=${locationId}`)).body.data).toHaveLength(0);
  });
});

describe("taxes and payment methods", () => {
  it("replaces a tax profile's rules as a unit (inclusive and exclusive profiles, several taxes)", async () => {
    const cat = await owner.post("/tax-categories", { name: "Standard goods" });
    const profile = await owner.post("/tax-profiles", { name: "UAE-like", countryCode: "AE", pricesIncludeTax: true });
    expect(profile.body.data.pricesIncludeTax).toBe(true);
    const id = profile.body.data.id;

    const put = await owner.put(`/tax-profiles/${id}/rules`, {
      rules: [
        { taxCategoryId: cat.body.data.id, name: "VAT", authorityCode: "fta", ratePercent: 5 },
        { name: "Municipality fee", authorityCode: "dm", ratePercent: 7.5, isCompound: true, orderTypes: ["DINE_IN"], sortOrder: 1 },
      ],
    });
    expect(put.status).toBe(200);
    expect(put.body.data.map((r: any) => [r.authorityCode, Number(r.ratePercent), r.isCompound])).toEqual([["FTA", 5, false], ["DM", 7.5, true]]);

    const detail = await owner.get(`/tax-profiles/${id}`);
    expect(detail.body.data.rules).toHaveLength(2);

    // replacing shrinks the set
    await owner.put(`/tax-profiles/${id}/rules`, { rules: [{ name: "VAT", authorityCode: "FTA", ratePercent: 5 }] });
    expect((await owner.get(`/tax-profiles/${id}`)).body.data.rules).toHaveLength(1);
    expect((await auditFor(fx.tenantId, "TaxProfile", id)).map((r) => r.action)).toEqual(["tax-profiles.create", "tax-profiles.rules.update", "tax-profiles.rules.update"]);
  });

  it("rejects impossible rates and unknown categories", async () => {
    const profile = await owner.post("/tax-profiles", { name: "Bad rates", countryCode: "PK", pricesIncludeTax: false });
    const id = profile.body.data.id;
    expect((await owner.put(`/tax-profiles/${id}/rules`, { rules: [{ name: "X", authorityCode: "x", ratePercent: 150 }] })).status).toBe(422);
    expect((await owner.put(`/tax-profiles/${id}/rules`, { rules: [{ name: "X", authorityCode: "x", ratePercent: -1 }] })).status).toBe(422);
    expect((await owner.put(`/tax-profiles/${id}/rules`, { rules: [{ taxCategoryId: crypto.randomUUID(), name: "X", authorityCode: "x", ratePercent: 5 }] })).status).toBe(422);
  });

  it("payment methods: default set exists, custom wallets can be added, filter by type", async () => {
    const list = await owner.get("/payment-methods?pageSize=100");
    expect(list.body.data.map((m: any) => m.type)).toEqual(expect.arrayContaining(["CASH", "CARD", "WALLET", "QR", "BANK_TRANSFER"]));
    const wallet = await owner.post("/payment-methods", { name: "JazzCash", type: "WALLET", providerCode: "JAZZCASH", requiresReference: true });
    expect(wallet.status).toBe(201);
    const wallets = await owner.get("/payment-methods?type=WALLET");
    expect(wallets.body.data.map((m: any) => m.name)).toContain("JazzCash");
  });

  it("price books: currency must exist", async () => {
    expect((await owner.post("/price-books", { name: "UAE", currencyCode: "AED" })).status).toBe(201);
    expect((await owner.post("/price-books", { name: "Nowhere", currencyCode: "ZZZ" })).status).toBe(422);
  });
});

describe("tenant profile, currencies, reason codes", () => {
  it("reads and updates the tenant, merging settings and validating them", async () => {
    const before = await owner.get("/tenant");
    expect(before.body.data.settings).toMatchObject({ varianceAmberPercent: 2, varianceRedPercent: 5, allowNegativeStock: true });

    const patch = await owner.patch("/tenant", { name: "Renamed Co", settings: { varianceRedPercent: 6 } });
    expect(patch.status).toBe(200);
    expect(patch.body.data.name).toBe("Renamed Co");
    expect(patch.body.data.settings).toMatchObject({ varianceAmberPercent: 2, varianceRedPercent: 6 }); // merged, not replaced
    expect((await owner.patch("/tenant", { settings: { varianceRedPercent: 500 } })).status).toBe(422);
    expect((await auditFor(fx.tenantId, "Tenant", fx.tenantId)).map((r) => r.action)).toContain("tenant.update");
  });

  it("lists currencies for any logged-in user", async () => {
    const res = await owner.get("/currencies");
    expect(res.body.data.map((c: any) => c.code)).toEqual(expect.arrayContaining(["PKR", "AED", "USD", "KWD"]));
    expect(res.body.data.find((c: any) => c.code === "KWD").minorUnitExponent).toBe(3);
  });

  it("seeds reason codes per tenant, including the system adjustment reasons", async () => {
    const adj = await owner.get("/reason-codes?type=ADJUSTMENT&pageSize=100");
    expect(adj.body.data.map((r: any) => r.code)).toEqual(expect.arrayContaining(["WASTE", "EXPIRY", "STAFF_MEAL", "DAMAGE", "THEFT"]));
    expect(adj.body.data.every((r: any) => r.isSystem)).toBe(true);
  });
});
