import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { runAsTenant } from "../../src/core/context/context.js";
import { db } from "../../src/core/db/scoped.js";
import { createBaseOrg, createFixture, createLocation, createStaff, loginOwner, loginStaff, type BaseOrg, type Fixture } from "../helpers/fixtures.js";
import { api, auditFor } from "../helpers/http.js";

const app = createApp();

describe("catalog", () => {
  let fx: Fixture;
  let base: BaseOrg;
  let owner: ReturnType<typeof api>;
  let ownerToken = "";
  let branchA: { id: string };
  let branchB: { id: string };
  let categoryId = "";
  let otherBrandCategoryId = "";
  let otherBrandId = "";
  let burger: any; // product created in the first test, reused afterwards

  beforeAll(async () => {
    fx = await createFixture();
    base = await createBaseOrg(fx);
    ownerToken = (await loginOwner(app, fx)).token;
    owner = api(app, ownerToken);
    branchA = await createLocation(fx, base, "A1");
    branchB = await createLocation(fx, base, "B1");
    categoryId = (await owner.post("/categories", { brandId: base.brandId, name: "Burgers" })).body.data.id;

    // a second brand, to prove that things never cross brands
    otherBrandId = await runAsTenant(fx.tenantId, async () => (await db.brand.create({ data: { tenantId: fx.tenantId, name: "Other", slug: `other-${fx.slug}` } })).id);
    otherBrandCategoryId = (await owner.post("/categories", { brandId: otherBrandId, name: "Pizza" })).body.data.id;
  }, 120_000);

  afterAll(async () => {
    await fx.cleanup();
    await unscopedDb.$disconnect();
  });

  // ------------------------------------------------------------------ products
  it("creates a product with variants and a modifier group in one transaction, with exactly one default", async () => {
    const group = await owner.post("/modifier-groups", { brandId: base.brandId, name: "Extras", minSelect: 0, maxSelect: 2, options: [{ name: "Cheese" }, { name: "Bacon" }] });
    expect(group.status).toBe(201);

    const res = await owner.post("/products", {
      brandId: base.brandId, categoryId, name: "Classic Burger", description: "Beef, lettuce", tags: ["HALAL", "BESTSELLER"], allergens: ["GLUTEN"],
      stationKey: "grill", variants: [{ name: "Regular" }, { name: "Large", isDefault: true }],
      modifierGroups: [{ modifierGroupId: group.body.data.id }],
    });
    expect(res.status).toBe(201);
    burger = res.body.data;
    expect(burger.variants.map((v: any) => [v.name, v.isDefault])).toEqual([["Regular", false], ["Large", true]]);
    expect(burger.stationKey).toBe("GRILL"); // normalised
    expect(burger.tags).toEqual(["HALAL", "BESTSELLER"]);
    expect(burger.modifiers).toHaveLength(1);
    expect((await auditFor(fx.tenantId, "Product", burger.id)).map((a) => a.action)).toEqual(["products.create"]);
  });

  it("with no variant flagged as default, the first one becomes the default", async () => {
    const res = await owner.post("/products", { brandId: base.brandId, categoryId, name: "Plain Fries", variants: [{ name: "Regular" }, { name: "Large" }] });
    expect(res.status).toBe(201);
    expect(res.body.data.variants.map((v: any) => v.isDefault)).toEqual([true, false]);
  });

  it("rejects bad input: no variants, two defaults, a category of another brand, an unknown tax category, a duplicate name", async () => {
    const ok = { brandId: base.brandId, categoryId, variants: [{ name: "Regular" }] };
    expect((await owner.post("/products", { ...ok, name: "No variants", variants: [] })).status).toBe(422);
    expect((await owner.post("/products", { ...ok, name: "Two defaults", variants: [{ name: "A", isDefault: true }, { name: "B", isDefault: true }] })).status).toBe(422);
    const wrongBrand = await owner.post("/products", { ...ok, name: "Wrong brand", categoryId: otherBrandCategoryId });
    expect(wrongBrand.status).toBe(422);
    expect(wrongBrand.body.error.details.fieldErrors.categoryId).toBeTruthy();
    expect((await owner.post("/products", { ...ok, name: "Bad tax", taxCategoryId: crypto.randomUUID() })).status).toBe(422);
    expect((await owner.post("/products", { ...ok, name: "classic burger" })).status).toBe(409); // names are unique per brand, case-insensitively
    expect((await owner.post("/products", { ...ok, name: "Bad tag", tags: ["NOT_A_TAG"] })).status).toBe(422);
  });

  it("updating variants keeps the ones with an id, adds new ones and archives the rest", async () => {
    const [regular, large] = burger.variants;
    const res = await owner.patch(`/products/${burger.id}`, { variants: [{ id: large.id, name: "Large", isDefault: true }, { name: "Jumbo" }] });
    expect(res.status).toBe(200);
    expect(res.body.data.variants.map((v: any) => v.name)).toEqual(["Large", "Jumbo"]);
    expect(res.body.data.variants[0].id).toBe(large.id); // the same row, so its prices and history stay attached
    const archived = await unscopedDb.productVariant.findUnique({ where: { id: regular.id } });
    expect(archived?.deletedAt).not.toBeNull(); // archived, not deleted
    burger = res.body.data;
  });

  it("archives and restores a product (history is kept)", async () => {
    const created = (await owner.post("/products", { brandId: base.brandId, categoryId, name: "Seasonal", variants: [{ name: "Regular" }] })).body.data;
    expect((await owner.del(`/products/${created.id}`)).status).toBe(204);
    expect((await owner.get(`/products/${created.id}`)).status).toBe(404);
    expect((await owner.get("/products?includeArchived=true&q=Seasonal")).body.data).toHaveLength(1);
    expect((await owner.post(`/products/${created.id}/restore`)).status).toBe(200);
    expect((await owner.get(`/products/${created.id}`)).status).toBe(200);
    const log = (await auditFor(fx.tenantId, "Product", created.id)).map((a) => a.action);
    expect(log).toEqual(["products.create", "products.archive", "products.restore"]);
  });

  it("modifier groups validate their limits", async () => {
    const base2 = { brandId: base.brandId, options: [{ name: "One" }, { name: "Two" }] };
    expect((await owner.post("/modifier-groups", { ...base2, name: "Bad", minSelect: 3, maxSelect: 2 })).status).toBe(422); // min above max
    expect((await owner.post("/modifier-groups", { ...base2, name: "Bad2", minSelect: 3, maxSelect: 3 })).status).toBe(422); // min above the number of options
    expect((await owner.post("/modifier-groups", { ...base2, name: "Bad3", options: [] })).status).toBe(422);
    const ok = await owner.post("/modifier-groups", { ...base2, name: "Sauce", minSelect: 1, maxSelect: 1 });
    expect(ok.status).toBe(201);
    const upd = await owner.patch(`/modifier-groups/${ok.body.data.id}`, { options: [{ id: ok.body.data.options[0].id, name: "Ketchup" }, { name: "Mayo" }, { name: "BBQ" }] });
    expect(upd.body.data.options.map((o: any) => o.name)).toEqual(["Ketchup", "Mayo", "BBQ"]);
  });

  // ------------------------------------------------------------------ prices
  describe("prices", () => {
    it("stamps the currency from the price book, stores integer minor units, and updates instead of duplicating", async () => {
      const variant = burger.variants[0].id;
      const put = (amountMinor: number) => owner.put("/prices", { prices: [{ target: { variantId: variant }, scope: { priceBookId: base.priceBookId }, amountMinor }] });
      const first = await put(125_000);
      expect(first.status).toBe(200);
      const second = await put(130_000);
      expect(second.body.data[0].id).toBe(first.body.data[0].id); // same row

      const list = await owner.get(`/prices?variantId=${variant}`);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({ amountMinor: 130_000, currencyCode: "PKR", channel: null });
      expect(Number.isInteger(list.body.data[0].amountMinor)).toBe(true);
    });

    it("rejects amounts that are not whole non-negative minor units, and unknown targets or scopes", async () => {
      const variant = burger.variants[0].id;
      const scope = { priceBookId: base.priceBookId };
      for (const amountMinor of [-1, 12.5, 2_000_000_001, "100"]) {
        expect((await owner.put("/prices", { prices: [{ target: { variantId: variant }, scope, amountMinor }] })).status, String(amountMinor)).toBe(422);
      }
      expect((await owner.put("/prices", { prices: [{ target: { variantId: crypto.randomUUID() }, scope, amountMinor: 100 }] })).status).toBe(422);
      expect((await owner.put("/prices", { prices: [{ target: { variantId: variant }, scope: { priceBookId: crypto.randomUUID() }, amountMinor: 100 }] })).status).toBe(422);
      expect((await owner.put("/prices", { prices: [{ target: { variantId: variant, comboId: crypto.randomUUID() }, scope, amountMinor: 100 }] })).status).toBe(422); // two targets
      expect((await owner.put("/prices", { prices: [{ target: { variantId: variant }, scope: { priceBookId: base.priceBookId, locationId: branchA.id }, amountMinor: 100 }] })).status).toBe(422); // two scopes
    });

    it("the database itself refuses a price with two targets or no scope", async () => {
      await expect(unscopedDb.$executeRawUnsafe(`INSERT INTO prices (id, "tenantId", "variantId", "comboId", "priceBookId", "amountMinor", "currencyCode", "updatedAt") VALUES (gen_random_uuid(), '${fx.tenantId}', '${burger.variants[0].id}', NULL, '${base.priceBookId}', 1, 'PKR', now()), (gen_random_uuid(), '${fx.tenantId}', NULL, NULL, '${base.priceBookId}', 1, 'PKR', now())`)).rejects.toThrow();
      await expect(unscopedDb.$executeRawUnsafe(`INSERT INTO prices (id, "tenantId", "variantId", "amountMinor", "currencyCode", "updatedAt") VALUES (gen_random_uuid(), '${fx.tenantId}', '${burger.variants[0].id}', 1, 'PKR', now())`)).rejects.toThrow();
    });

    it("a price book of another brand cannot price this brand's item", async () => {
      const otherBook = await runAsTenant(fx.tenantId, () => db.priceBook.create({ data: { tenantId: fx.tenantId, brandId: otherBrandId, name: "Other PKR", currencyCode: "PKR" } }));
      const res = await owner.put("/prices", { prices: [{ target: { variantId: burger.variants[0].id }, scope: { priceBookId: otherBook.id }, amountMinor: 100 }] });
      expect(res.status).toBe(422);
    });

    it("a branch override and a channel price take precedence, and deleting restores the fallback", async () => {
      const variant = burger.variants[0].id;
      const set = (scope: object, amountMinor: number, channel?: string) => owner.put("/prices", { prices: [{ target: { variantId: variant }, scope, amountMinor, ...(channel && { channel }) }] });
      expect((await set({ locationId: branchA.id }, 150_000)).status).toBe(200);
      const web = await set({ priceBookId: base.priceBookId }, 140_000, "WEB");
      expect(web.status).toBe(200);

      const menu = async (loc: string, channel?: string) => (await owner.get(`/catalog/sellable?locationId=${loc}${channel ? `&channel=${channel}` : ""}`)).body.data;
      const priceIn = (m: any) => m.categories.flatMap((c: any) => c.products).find((p: any) => p.id === burger.id)?.variants.find((v: any) => v.id === variant)?.priceMinor;
      expect(priceIn(await menu(branchA.id))).toBe(150_000); // branch override
      expect(priceIn(await menu(branchB.id))).toBe(130_000); // book
      expect(priceIn(await menu(branchB.id, "WEB"))).toBe(140_000); // book + channel
      expect(priceIn(await menu(branchA.id, "WEB"))).toBe(150_000); // branch beats book + channel

      const rows = (await owner.get(`/prices?variantId=${variant}&locationId=${branchA.id}`)).body.data;
      expect((await owner.post("/prices/delete", { ids: [rows[0].id] })).status).toBe(204);
      expect(priceIn(await menu(branchA.id))).toBe(130_000); // back to the book
    });

    it("every price change is audited with before and after", async () => {
      const entries = await unscopedDb.auditLog.findMany({ where: { tenantId: fx.tenantId, action: { in: ["prices.update", "prices.delete"] } } });
      expect(entries.length).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(entries.map((e) => e.after))).toContain("130000");
    });
  });

  // ------------------------------------------------------------------ the sellable menu
  describe("sellable menu", () => {
    let veg: any;

    beforeAll(async () => {
      veg = (await owner.post("/products", { brandId: base.brandId, categoryId, name: "Veg Wrap", variants: [{ name: "Regular" }] })).body.data;
      await owner.put("/prices", { prices: [{ target: { variantId: veg.variants[0].id }, scope: { priceBookId: base.priceBookId }, amountMinor: 80_000 }] });
    });

    const sellable = async (loc: string, query = "") => (await owner.get(`/catalog/sellable?locationId=${loc}${query}`)).body.data;
    const names = (m: any) => m.categories.flatMap((c: any) => c.products.map((p: any) => p.name)).sort();

    it("lists only active, priced products, grouped by category", async () => {
      const m = await sellable(branchA.id);
      expect(names(m)).toEqual(["Classic Burger", "Veg Wrap"]); // Plain Fries and Seasonal have no price yet
      expect(m.currencyCode).toBe("PKR");
      expect(m.categories[0].name).toBe("Burgers");
      const b = m.categories[0].products.find((p: any) => p.name === "Classic Burger");
      expect(b.modifierGroups[0].options.map((o: any) => o.name)).toEqual(["Cheese", "Bacon"]);
      expect(b.modifierGroups[0].maxSelect).toBe(2);
    });

    it("86 hides an item at that branch only, immediately, and restocking brings it back", async () => {
      const r = await owner.put("/availability", { locationId: branchA.id, target: { productId: veg.id }, isAvailable: false });
      expect(r.status).toBe(200);
      expect(names(await sellable(branchA.id))).toEqual(["Classic Burger"]);
      expect(names(await sellable(branchB.id))).toEqual(["Classic Burger", "Veg Wrap"]); // other branch unaffected
      await owner.put("/availability", { locationId: branchA.id, target: { productId: veg.id }, isAvailable: true });
      expect(names(await sellable(branchA.id))).toContain("Veg Wrap");
      const actions = (await unscopedDb.auditLog.findMany({ where: { tenantId: fx.tenantId, action: { startsWith: "availability." } }, orderBy: { occurredAt: "asc" } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(["availability.86", "availability.restock"]));
    });

    it("an 86 with a timer lapses by itself, unlisting is permanent until changed, and reset restocks everything", async () => {
      await owner.put("/availability", { locationId: branchA.id, target: { productId: veg.id }, isAvailable: false, soldOutUntil: new Date(Date.now() + 3_600_000).toISOString() });
      expect(names(await sellable(branchA.id))).not.toContain("Veg Wrap");
      expect(names(await sellable(branchA.id, `&at=${new Date(Date.now() + 2 * 3_600_000).toISOString()}`))).toContain("Veg Wrap"); // two hours later

      await owner.put("/availability", { locationId: branchA.id, target: { productId: veg.id }, isListed: false, isAvailable: true });
      expect(names(await sellable(branchA.id))).not.toContain("Veg Wrap");
      await owner.put("/availability", { locationId: branchA.id, target: { productId: veg.id }, isListed: true });
      await owner.put("/availability", { locationId: branchA.id, target: { productId: burger.id }, isAvailable: false });
      const reset = await owner.post("/availability/reset", { locationId: branchA.id });
      expect(reset.body.data.restocked).toBeGreaterThanOrEqual(1);
      expect(names(await sellable(branchA.id))).toEqual(["Classic Burger", "Veg Wrap"]);
    });

    it("a modifier option that is 86'd disappears from its group", async () => {
      const cheese = burger.modifiers[0].modifierGroup.id;
      const group = (await owner.get(`/modifier-groups/${cheese}`)).body.data;
      await owner.put("/availability", { locationId: branchA.id, target: { modifierOptionId: group.options[0].id }, isAvailable: false });
      const m = await sellable(branchA.id);
      const b = m.categories.flatMap((c: any) => c.products).find((p: any) => p.name === "Classic Burger");
      expect(b.modifierGroups[0].options.map((o: any) => o.name)).toEqual(["Bacon"]);
      await owner.post("/availability/reset", { locationId: branchA.id });
    });

    it("an inactive product or category is not sold", async () => {
      await owner.patch(`/products/${veg.id}`, { isActive: false });
      expect(names(await sellable(branchA.id))).not.toContain("Veg Wrap");
      await owner.patch(`/products/${veg.id}`, { isActive: true });
      await owner.patch(`/categories/${categoryId}`, { isActive: false });
      expect((await sellable(branchA.id)).categories).toEqual([]);
      await owner.patch(`/categories/${categoryId}`, { isActive: true });
    });

    it("menus decide WHEN things are sold, in the branch's timezone", async () => {
      const lunch = await owner.post("/menus", {
        brandId: base.brandId, name: "Lunch", productIds: [veg.id],
        schedules: [{ weekdays: [1, 2, 3, 4, 5], startsAt: "11:00", endsAt: "16:00" }],
      });
      expect(lunch.status).toBe(201);
      // Monday 2026-11-09, Asia/Karachi is UTC+5: 07:00Z is 12:00 there (lunch), 12:30Z is 17:30 there (not lunch)
      const atLunch = await sellable(branchA.id, "&at=2026-11-09T07:00:00Z");
      const evening = await sellable(branchA.id, "&at=2026-11-09T12:30:00Z");
      expect(names(atLunch)).toEqual(["Veg Wrap"]); // once a brand has menus, only what a served menu lists is sold
      expect(names(evening)).toEqual([]);

      const all = await owner.post("/menus", { brandId: base.brandId, name: "All day", isDefault: true, productIds: [burger.id], schedules: [] });
      expect(names(await sellable(branchA.id, "&at=2026-11-09T12:30:00Z"))).toEqual(["Classic Burger"]); // the default menu with no schedule is always served
      expect(names(atLunch)).toEqual(["Veg Wrap"]);
      expect(names(await sellable(branchA.id, "&at=2026-11-09T07:00:00Z"))).toEqual(["Classic Burger", "Veg Wrap"]);

      // only one default menu per brand
      await owner.patch(`/menus/${lunch.body.data.id}`, { isDefault: true });
      expect((await owner.get(`/menus/${all.body.data.id}`)).body.data.isDefault).toBe(false);
      await owner.del(`/menus/${lunch.body.data.id}`);
      await owner.del(`/menus/${all.body.data.id}`);
      expect(names(await sellable(branchA.id))).toEqual(["Classic Burger", "Veg Wrap"]); // no menus: everything priced is sold
    });

    it("validates menu schedules", async () => {
      const bad = (schedules: unknown[]) => owner.post("/menus", { brandId: base.brandId, name: `M${Math.random()}`, productIds: [], schedules });
      expect((await bad([{ weekdays: [], startsAt: null, endsAt: null }])).status).toBe(422); // no days
      expect((await bad([{ weekdays: [1], startsAt: "11:00", endsAt: null }])).status).toBe(422); // one time only
      expect((await bad([{ weekdays: [1], startsAt: "25:00", endsAt: "26:00" }])).status).toBe(422);
      expect((await bad([{ weekdays: [1], startsAt: "10:00", endsAt: "10:00" }])).status).toBe(422);
      expect((await bad([{ weekdays: [9], startsAt: null, endsAt: null }])).status).toBe(422);
      expect((await owner.post("/menus", { brandId: base.brandId, name: "Cross brand", productIds: [(await owner.post("/products", { brandId: otherBrandId, categoryId: otherBrandCategoryId, name: "Margherita", variants: [{ name: "Regular" }] })).body.data.id], schedules: [] })).status).toBe(422);
    });
  });

  // ------------------------------------------------------------------ combos
  describe("combos", () => {
    it("builds a choice combo, prices it with an up-charge, and removing a choice removes its up-charge price", async () => {
      const drink = (await owner.post("/products", { brandId: base.brandId, categoryId, name: "Cola", variants: [{ name: "Can" }, { name: "Large" }] })).body.data;
      const res = await owner.post("/combos", {
        brandId: base.brandId, name: "Burger Deal",
        slots: [
          { name: "Burger", quantity: 1, options: [{ variantId: burger.variants[0].id, isDefault: true }] },
          { name: "Drink", quantity: 1, options: [{ variantId: drink.variants[0].id, isDefault: true }, { variantId: drink.variants[1].id }] },
        ],
      });
      expect(res.status).toBe(201);
      const combo = res.body.data;
      const large = combo.slots[1].options.find((o: any) => o.variantId === drink.variants[1].id);

      await owner.put("/prices", { prices: [
        { target: { comboId: combo.id }, scope: { priceBookId: base.priceBookId }, amountMinor: 160_000, compareAtMinor: 190_000 },
        { target: { comboSlotOptionId: large.id }, scope: { priceBookId: base.priceBookId }, amountMinor: 20_000 },
      ] });
      const m = (await owner.get(`/catalog/sellable?locationId=${branchA.id}`)).body.data;
      expect(m.combos).toHaveLength(1);
      expect(m.combos[0]).toMatchObject({ name: "Burger Deal", priceMinor: 160_000, compareAtMinor: 190_000 });
      expect(m.combos[0].slots[1].options.map((o: any) => o.upchargeMinor).sort()).toEqual([0, 20_000]);

      // drop the "Large" choice: its up-charge price must go with it (no orphan price)
      const keepOption = combo.slots[1].options.find((o: any) => o.id !== large.id);
      const upd = await owner.patch(`/combos/${combo.id}`, { slots: [{ id: combo.slots[0].id, name: "Burger", quantity: 1, options: [{ id: combo.slots[0].options[0].id, variantId: burger.variants[0].id }] }, { id: combo.slots[1].id, name: "Drink", quantity: 1, options: [{ id: keepOption.id, variantId: keepOption.variantId }] }] });
      expect(upd.status).toBe(200);
      expect(upd.body.data.slots[1].options).toHaveLength(1);
      expect((await owner.get(`/prices?comboSlotOptionId=${large.id}`)).body.data).toHaveLength(0);

      // a combo can be limited to a time window and 86'd like a product
      await owner.patch(`/combos/${combo.id}`, { endsAt: new Date(Date.now() - 60_000).toISOString(), startsAt: new Date(Date.now() - 3_600_000).toISOString() });
      expect((await owner.get(`/catalog/sellable?locationId=${branchA.id}`)).body.data.combos).toHaveLength(0); // window is over
      await owner.patch(`/combos/${combo.id}`, { endsAt: null, startsAt: null });
      expect((await owner.get(`/catalog/sellable?locationId=${branchA.id}`)).body.data.combos).toHaveLength(1);
      await owner.put("/availability", { locationId: branchA.id, target: { comboId: combo.id }, isAvailable: false });
      expect((await owner.get(`/catalog/sellable?locationId=${branchA.id}`)).body.data.combos).toHaveLength(0);
    });

    it("rejects a combo built from another brand's items and validates the window", async () => {
      const other = (await owner.post("/products", { brandId: otherBrandId, categoryId: otherBrandCategoryId, name: "Calzone", variants: [{ name: "Regular" }] })).body.data;
      const bad = await owner.post("/combos", { brandId: base.brandId, name: "Mixed", slots: [{ name: "Item", quantity: 1, options: [{ variantId: other.variants[0].id }] }] });
      expect(bad.status).toBe(422);
      const window = await owner.post("/combos", { brandId: base.brandId, name: "Backwards", startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", slots: [{ name: "Item", quantity: 1, options: [{ variantId: burger.variants[0].id }] }] });
      expect(window.status).toBe(422);
      expect((await owner.post("/combos", { brandId: base.brandId, name: "Empty", slots: [] })).status).toBe(422);
    });
  });

  // ------------------------------------------------------------------ permissions and scope
  describe("permissions", () => {
    it("reading needs menu.view; writing needs menu.manage; prices need menu.price.edit; 86 needs menu.availability.toggle", async () => {
      const viewer = api(app, (await loginStaff(app, await createStaff(fx, { permissions: ["menu.view"] }))).token);
      const manager = api(app, (await loginStaff(app, await createStaff(fx, { permissions: ["menu.view", "menu.manage"] }))).token);
      const pricer = api(app, (await loginStaff(app, await createStaff(fx, { permissions: ["menu.view", "menu.price.edit"], allLocations: true }))).token);
      const kitchen = api(app, (await loginStaff(app, await createStaff(fx, { permissions: ["menu.view", "menu.availability.toggle"], allLocations: true }))).token);

      const product = { brandId: base.brandId, categoryId, name: "Forbidden Dish", variants: [{ name: "Regular" }] };
      const price = { prices: [{ target: { variantId: burger.variants[0].id }, scope: { priceBookId: base.priceBookId }, amountMinor: 1 }] };
      const toggle = { locationId: branchA.id, target: { productId: burger.id }, isAvailable: true };

      expect((await viewer.get("/products")).status).toBe(200);
      expect((await viewer.post("/products", product)).status).toBe(403);
      expect((await viewer.put("/prices", price)).status).toBe(403);
      expect((await viewer.put("/availability", toggle)).status).toBe(403);

      expect((await manager.post("/products", product)).status).toBe(201);
      expect((await manager.put("/prices", price)).status).toBe(403); // can write the menu but not the money
      expect((await pricer.post("/products", { ...product, name: "Another" })).status).toBe(403);
      expect((await pricer.put("/prices", price)).status).toBe(200);
      expect((await kitchen.put("/availability", toggle)).status).toBe(200);
      expect((await kitchen.post("/products", { ...product, name: "Yet Another" })).status).toBe(403);
    });

    it("branch-limited staff can 86 and price only their own branch, never the price book", async () => {
      const staff = await createStaff(fx, { permissions: ["menu.view", "menu.price.edit", "menu.availability.toggle"], allLocations: false, locationIds: [branchA.id] });
      const asStaff = api(app, (await loginStaff(app, staff)).token);
      const variant = burger.variants[0].id;

      expect((await asStaff.put("/availability", { locationId: branchA.id, target: { productId: burger.id }, isAvailable: false })).status).toBe(200);
      expect((await asStaff.put("/availability", { locationId: branchB.id, target: { productId: burger.id }, isAvailable: false })).status).toBe(404); // not theirs
      expect((await asStaff.put("/prices", { prices: [{ target: { variantId: variant }, scope: { locationId: branchA.id }, amountMinor: 99_000 }] })).status).toBe(200);
      expect((await asStaff.put("/prices", { prices: [{ target: { variantId: variant }, scope: { locationId: branchB.id }, amountMinor: 99_000 }] })).status).toBe(422);
      expect((await asStaff.put("/prices", { prices: [{ target: { variantId: variant }, scope: { priceBookId: base.priceBookId }, amountMinor: 99_000 }] })).status).toBe(403);
      expect((await asStaff.get(`/catalog/sellable?locationId=${branchB.id}`)).status).toBe(404);
      await owner.post("/availability/reset", { locationId: branchA.id });
    });
  });

  // ------------------------------------------------------------------ isolation
  describe("tenant isolation", () => {
    it("another organization cannot see or change this catalog", async () => {
      const other = await createFixture();
      try {
        const asB = api(app, (await loginOwner(app, other)).token);
        expect((await asB.get(`/products/${burger.id}`)).status).toBe(404);
        expect((await asB.get("/products")).body.data).toHaveLength(0);
        expect((await asB.get(`/catalog/sellable?locationId=${branchA.id}`)).status).toBe(404);
        expect((await asB.put("/availability", { locationId: branchA.id, target: { productId: burger.id }, isAvailable: false })).status).toBe(404);
        expect((await asB.put("/prices", { prices: [{ target: { variantId: burger.variants[0].id }, scope: { priceBookId: base.priceBookId }, amountMinor: 1 }] })).status).toBe(422);
        expect((await asB.patch(`/products/${burger.id}`, { name: "Hijacked" })).status).toBe(404);
        expect((await asB.del(`/products/${burger.id}`)).status).toBe(404);
        expect((await owner.get(`/products/${burger.id}`)).body.data.name).toBe("Classic Burger");
      } finally {
        await other.cleanup();
      }
    });
  });
});
