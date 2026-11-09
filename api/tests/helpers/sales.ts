import { randomUUID } from "node:crypto";
import { runAsTenant } from "../../src/core/context/context.js";
import { db } from "../../src/core/db/scoped.js";
import { createBaseOrg, createLocation, createStaff, loginStaff, type BaseOrg, type Fixture, type Staff } from "./fixtures.js";
import { api } from "./http.js";
import type { Express } from "express";

// A ready-made restaurant for the sales tests, built straight in the database (fast), so each test file
// can spend its time on behaviour instead of setup:
//   branch PKR: 13% tax added on top;   branch AED: 5% VAT already inside the price.
//   Burger (Single 1,000.00 / Double 2,000.00) with Extras and a required Sauce, Fries, Cola, and a Meal combo.

export interface SalesWorld {
  base: BaseOrg;
  pkr: { id: string; code: string };
  aed: { id: string; code: string };
  burger: { id: string; single: string; double: string; extras: { id: string; cheese: string; bacon: string; sauce: string; ketchup: string; bbq: string; sauceGroup: string; extrasGroup: string } };
  fries: { id: string; regular: string };
  cola: { id: string; can: string };
  meal: { id: string; burgerSlot: string; burgerOption: string; drinkSlot: string; colaOption: string; lemonadeOption: string; sideSlot: string; friesOption: string };
  other: { burgerVariant: string; modifierOption: string };
  reasons: Record<"void" | "refund" | "discount" | "cashOut", string>;
  methods: { cash: string; card: string };
  table: string;
  cashier: Staff;
  manager: Staff;
  kitchen: Staff;
  as: { cashier: ReturnType<typeof api>; manager: ReturnType<typeof api>; kitchen: ReturnType<typeof api> };
}

export const PRICES = {
  burgerSingle: 100_000, burgerDouble: 200_000, cheese: 8_000, bacon: 15_000, bbq: 3_000, fries: 30_000, cola: 15_000, lemonadeUp: 5_000, meal: 180_000,
};

export async function buildSalesWorld(fx: Fixture, app: Express): Promise<SalesWorld> {
  const base = await createBaseOrg(fx);
  const tenantId = fx.tenantId;
  const ids = {
    burger: randomUUID(), single: randomUUID(), double: randomUUID(), fries: randomUUID(), friesV: randomUUID(), cola: randomUUID(), colaV: randomUUID(), lemonade: randomUUID(), lemonadeV: randomUUID(),
    category: randomUUID(), extras: randomUUID(), cheese: randomUUID(), bacon: randomUUID(), sauce: randomUUID(), ketchup: randomUUID(), bbq: randomUUID(),
    meal: randomUUID(), s1: randomUUID(), s2: randomUUID(), s3: randomUUID(), burgerOpt: randomUUID(), colaOpt: randomUUID(), lemOpt: randomUUID(), friesOpt: randomUUID(),
    otherCat: randomUUID(), otherBrand: randomUUID(), otherProduct: randomUUID(), otherVariant: randomUUID(), otherGroup: randomUUID(), otherOption: randomUUID(),
    std: randomUUID(), tax13: randomUUID(), vat: randomUUID(), uaeProfile: randomUUID(), aedBook: randomUUID(), table: randomUUID(),
  };

  const { pkrBranch, aedBranch, methods, reasons } = await runAsTenant(tenantId, async () => {
    await db.taxCategory.create({ data: { id: ids.std, tenantId, name: "Standard" } });
    await db.taxRule.create({ data: { id: ids.tax13, tenantId, taxProfileId: base.taxProfileId, taxCategoryId: ids.std, name: "SRB sales tax", authorityCode: "SRB", ratePercent: 13 } });
    await db.taxProfile.create({ data: { id: ids.uaeProfile, tenantId, name: "UAE VAT", countryCode: "AE", pricesIncludeTax: true } });
    await db.taxRule.create({ data: { id: ids.vat, tenantId, taxProfileId: ids.uaeProfile, taxCategoryId: ids.std, name: "VAT", authorityCode: "FTA", ratePercent: 5 } });
    await db.priceBook.create({ data: { id: ids.aedBook, tenantId, brandId: base.brandId, name: "AED", currencyCode: "AED" } });

    await db.category.create({ data: { id: ids.category, tenantId, brandId: base.brandId, name: "Food" } });
    await db.modifierGroup.createMany({ data: [{ id: ids.extras, tenantId, brandId: base.brandId, name: "Extras", minSelect: 0, maxSelect: 2 }, { id: ids.sauce, tenantId, brandId: base.brandId, name: "Sauce", minSelect: 1, maxSelect: 1 }] });
    await db.modifierOption.createMany({ data: [
      { id: ids.cheese, tenantId, groupId: ids.extras, name: "Cheese" }, { id: ids.bacon, tenantId, groupId: ids.extras, name: "Bacon" },
      { id: ids.ketchup, tenantId, groupId: ids.sauce, name: "Ketchup" }, { id: ids.bbq, tenantId, groupId: ids.sauce, name: "BBQ" },
    ] });
    await db.product.createMany({ data: [
      { id: ids.burger, tenantId, brandId: base.brandId, categoryId: ids.category, name: "Burger", taxCategoryId: ids.std, stationKey: "GRILL" },
      { id: ids.fries, tenantId, brandId: base.brandId, categoryId: ids.category, name: "Fries", taxCategoryId: ids.std, stationKey: "FRY" },
      { id: ids.cola, tenantId, brandId: base.brandId, categoryId: ids.category, name: "Cola", taxCategoryId: ids.std, stationKey: "BAR" },
      { id: ids.lemonade, tenantId, brandId: base.brandId, categoryId: ids.category, name: "Lemonade", taxCategoryId: ids.std, stationKey: "BAR" },
    ] });
    await db.productVariant.createMany({ data: [
      { id: ids.single, tenantId, productId: ids.burger, name: "Single", isDefault: true }, { id: ids.double, tenantId, productId: ids.burger, name: "Double" },
      { id: ids.friesV, tenantId, productId: ids.fries, name: "Regular", isDefault: true }, { id: ids.colaV, tenantId, productId: ids.cola, name: "Can", isDefault: true }, { id: ids.lemonadeV, tenantId, productId: ids.lemonade, name: "Regular", isDefault: true },
    ] });
    await db.productModifierGroup.createMany({ data: [{ tenantId, productId: ids.burger, modifierGroupId: ids.extras, sortOrder: 0 }, { tenantId, productId: ids.burger, modifierGroupId: ids.sauce, sortOrder: 1 }] });

    await db.combo.create({ data: { id: ids.meal, tenantId, brandId: base.brandId, name: "Meal", taxCategoryId: ids.std } });
    await db.comboSlot.createMany({ data: [{ id: ids.s1, tenantId, comboId: ids.meal, name: "Burger", quantity: 1, sortOrder: 0 }, { id: ids.s2, tenantId, comboId: ids.meal, name: "Drink", quantity: 1, sortOrder: 1 }, { id: ids.s3, tenantId, comboId: ids.meal, name: "Side", quantity: 1, sortOrder: 2 }] });
    await db.comboSlotOption.createMany({ data: [
      { id: ids.burgerOpt, tenantId, slotId: ids.s1, variantId: ids.single, isDefault: true }, { id: ids.colaOpt, tenantId, slotId: ids.s2, variantId: ids.colaV, isDefault: true },
      { id: ids.lemOpt, tenantId, slotId: ids.s2, variantId: ids.lemonadeV }, { id: ids.friesOpt, tenantId, slotId: ids.s3, variantId: ids.friesV, isDefault: true },
    ] });

    // prices: PKR book (base.priceBookId) and an AED book
    const pkr = (target: Record<string, string>, amountMinor: number) => ({ id: randomUUID(), tenantId, ...target, priceBookId: base.priceBookId, currencyCode: "PKR", amountMinor });
    const aed = (target: Record<string, string>, amountMinor: number) => ({ id: randomUUID(), tenantId, ...target, priceBookId: ids.aedBook, currencyCode: "AED", amountMinor });
    await db.price.createMany({ data: [
      pkr({ variantId: ids.single }, PRICES.burgerSingle), pkr({ variantId: ids.double }, PRICES.burgerDouble), pkr({ variantId: ids.friesV }, PRICES.fries), pkr({ variantId: ids.colaV }, PRICES.cola), pkr({ variantId: ids.lemonadeV }, PRICES.cola),
      pkr({ modifierOptionId: ids.cheese }, PRICES.cheese), pkr({ modifierOptionId: ids.bacon }, PRICES.bacon), pkr({ modifierOptionId: ids.bbq }, PRICES.bbq),
      pkr({ comboId: ids.meal }, PRICES.meal), pkr({ comboSlotOptionId: ids.lemOpt }, PRICES.lemonadeUp),
      aed({ variantId: ids.single }, 2_500), aed({ variantId: ids.double }, 4_000), aed({ variantId: ids.friesV }, 1_000), aed({ variantId: ids.colaV }, 500), aed({ modifierOptionId: ids.bbq }, 100),
    ] });

    // a second brand's item, to prove things never cross brands
    await db.brand.create({ data: { id: ids.otherBrand, tenantId, name: "Other", slug: `other-${fx.slug}` } });
    await db.category.create({ data: { id: ids.otherCat, tenantId, brandId: ids.otherBrand, name: "Other food" } });
    await db.product.create({ data: { id: ids.otherProduct, tenantId, brandId: ids.otherBrand, categoryId: ids.otherCat, name: "Foreign dish" } });
    await db.productVariant.create({ data: { id: ids.otherVariant, tenantId, productId: ids.otherProduct, name: "Regular", isDefault: true } });
    await db.modifierGroup.create({ data: { id: ids.otherGroup, tenantId, brandId: ids.otherBrand, name: "Foreign extras", minSelect: 0, maxSelect: 1 } });
    await db.modifierOption.create({ data: { id: ids.otherOption, tenantId, groupId: ids.otherGroup, name: "Foreign option" } });

    const methodRows = await db.paymentMethod.findMany();
    const reasonRows = await db.reasonCode.findMany();
    const reason = (type: string) => reasonRows.find((r) => r.type === type && !r.requiresNote)!.id;
    return {
      pkrBranch: await createLocation(fx, base, "PK1", { name: "Karachi" }),
      aedBranch: await db.location.create({ data: { tenantId, type: "BRANCH", brandId: base.brandId, code: "AE1", name: "Dubai", countryCode: "AE", timezone: "Asia/Dubai", currencyCode: "AED", taxProfileId: ids.uaeProfile, priceBookId: ids.aedBook, orderPrefix: "DX" } }),
      methods: { cash: methodRows.find((m) => m.type === "CASH")!.id, card: methodRows.find((m) => m.name === "Card")!.id },
      reasons: { void: reason("VOID"), refund: reason("REFUND"), discount: reason("DISCOUNT"), cashOut: reason("CASH_OUT") },
    };
  });

  await runAsTenant(tenantId, async () => {
    await db.location.update({ where: { id: pkrBranch.id }, data: { orderPrefix: "KH" } });
    for (const loc of [pkrBranch.id, aedBranch.id]) {
      await db.locationPaymentMethod.createMany({ data: [methods.cash, methods.card].map((paymentMethodId, i) => ({ tenantId, locationId: loc, paymentMethodId, sortOrder: i })) });
    }
    await db.diningTable.create({ data: { id: ids.table, tenantId, locationId: pkrBranch.id, name: "T1", seats: 4 } });
  });

  const cashier = await createStaff(fx, { roleName: "Cashier", locationIds: [pkrBranch.id] });
  const manager = await createStaff(fx, { roleName: "Branch Manager", locationIds: [pkrBranch.id], pin: "4821" });
  const kitchen = await createStaff(fx, { roleName: "Kitchen Staff", locationIds: [pkrBranch.id] });
  const as = {
    cashier: api(app, (await loginStaff(app, cashier)).token),
    manager: api(app, (await loginStaff(app, manager)).token),
    kitchen: api(app, (await loginStaff(app, kitchen)).token),
  };

  return {
    base, pkr: { id: pkrBranch.id, code: "PK1" }, aed: { id: aedBranch.id, code: "AE1" },
    burger: { id: ids.burger, single: ids.single, double: ids.double, extras: { id: ids.extras, cheese: ids.cheese, bacon: ids.bacon, sauce: ids.sauce, ketchup: ids.ketchup, bbq: ids.bbq, sauceGroup: ids.sauce, extrasGroup: ids.extras } },
    fries: { id: ids.fries, regular: ids.friesV }, cola: { id: ids.cola, can: ids.colaV },
    meal: { id: ids.meal, burgerSlot: ids.s1, burgerOption: ids.burgerOpt, drinkSlot: ids.s2, colaOption: ids.colaOpt, lemonadeOption: ids.lemOpt, sideSlot: ids.s3, friesOption: ids.friesOpt },
    other: { burgerVariant: ids.otherVariant, modifierOption: ids.otherOption },
    reasons, methods, table: ids.table, cashier, manager, kitchen, as,
  };
}

/** A typical order body: 2 double burgers with cheese and BBQ sauce, plus fries. */
export const typicalOrder = (w: SalesWorld, over: Record<string, unknown> = {}) => ({
  locationId: w.pkr.id, orderType: "TAKEAWAY", channel: "POS",
  lines: [
    { kind: "item", variantId: w.burger.double, quantity: 2, modifierOptionIds: [w.burger.extras.cheese, w.burger.extras.bbq] },
    { kind: "item", variantId: w.fries.regular, quantity: 1 },
  ],
  ...over,
});
/** 2 x (200,000 + 8,000 + 3,000) + 30,000 */
export const TYPICAL_SUBTOTAL = 2 * (PRICES.burgerDouble + PRICES.cheese + PRICES.bbq) + PRICES.fries;
