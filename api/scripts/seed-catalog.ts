import { randomUUID } from "node:crypto";
import { db } from "../src/core/db/scoped.js";

// The demo menu: two brands with categories, sizes, add-ons, combos, dayparts, prices in three
// currencies, a branch price override, a web-channel price and a couple of 86'd items.
// Called by seed-demo.ts inside the demo tenant's context. Inserts are batched (createMany) because the
// database is remote and one round trip per row would take minutes.

interface ProductDef {
  name: string;
  category: string;
  description?: string;
  tags?: string[];
  allergens?: string[];
  station: "GRILL" | "FRY" | "BAR";
  /** whole PKR (rupees) per size; other currencies are derived */
  variants: { name: string; pkr: number }[];
  groups?: string[];
}
interface GroupDef { name: string; min: number; max: number; options: { name: string; pkr: number }[] }
interface BrandDef { categories: string[]; groups: GroupDef[]; products: ProductDef[] }

const SMASH: BrandDef = {
  categories: ["Burgers", "Sides", "Drinks", "Desserts"],
  groups: [
    { name: "Extras", min: 0, max: 3, options: [{ name: "Cheese slice", pkr: 80 }, { name: "Beef bacon", pkr: 150 }, { name: "Fried egg", pkr: 100 }, { name: "Jalapeños", pkr: 50 }] },
    { name: "Sauce", min: 1, max: 1, options: [{ name: "Ketchup", pkr: 0 }, { name: "Mayo", pkr: 0 }, { name: "Smash sauce", pkr: 0 }, { name: "Smoky BBQ", pkr: 30 }] },
  ],
  products: [
    { name: "Classic Smash", category: "Burgers", description: "Two smashed beef patties, pickles, onion and our smash sauce.", tags: ["HALAL", "BESTSELLER"], allergens: ["GLUTEN", "DAIRY", "SESAME"], station: "GRILL", variants: [{ name: "Single", pkr: 890 }, { name: "Double", pkr: 1190 }], groups: ["Extras", "Sauce"] },
    { name: "Cheese Smash", category: "Burgers", description: "Classic with melted American cheese.", tags: ["HALAL"], allergens: ["GLUTEN", "DAIRY", "SESAME"], station: "GRILL", variants: [{ name: "Single", pkr: 950 }, { name: "Double", pkr: 1290 }], groups: ["Extras", "Sauce"] },
    { name: "Spicy Chicken Crunch", category: "Burgers", description: "Crispy fried chicken, jalapeño mayo, slaw.", tags: ["HALAL", "SPICY"], allergens: ["GLUTEN", "EGG"], station: "FRY", variants: [{ name: "Regular", pkr: 990 }], groups: ["Extras", "Sauce"] },
    { name: "Garden Veggie", category: "Burgers", description: "Crisp veggie patty, avocado spread.", tags: ["VEGETARIAN", "NEW"], allergens: ["GLUTEN"], station: "GRILL", variants: [{ name: "Regular", pkr: 790 }], groups: ["Extras", "Sauce"] },
    { name: "Fries", category: "Sides", tags: ["VEGAN", "GLUTEN_FREE"], station: "FRY", variants: [{ name: "Regular", pkr: 290 }, { name: "Large", pkr: 390 }] },
    { name: "Onion Rings", category: "Sides", tags: ["VEGETARIAN"], allergens: ["GLUTEN"], station: "FRY", variants: [{ name: "Regular", pkr: 350 }] },
    { name: "Coleslaw", category: "Sides", tags: ["VEGETARIAN"], allergens: ["EGG"], station: "GRILL", variants: [{ name: "Regular", pkr: 190 }] },
    { name: "Cola", category: "Drinks", station: "BAR", variants: [{ name: "Can", pkr: 180 }] },
    { name: "Fresh Lemonade", category: "Drinks", tags: ["VEGAN"], station: "BAR", variants: [{ name: "Regular", pkr: 290 }, { name: "Large", pkr: 390 }] },
    { name: "Milkshake", category: "Drinks", allergens: ["DAIRY"], station: "BAR", variants: [{ name: "Chocolate", pkr: 590 }, { name: "Vanilla", pkr: 590 }, { name: "Strawberry", pkr: 590 }] },
    { name: "Fudge Brownie", category: "Desserts", tags: ["VEGETARIAN"], allergens: ["GLUTEN", "DAIRY", "EGG", "NUTS"], station: "GRILL", variants: [{ name: "Regular", pkr: 450 }] },
  ],
};

const SAFFRON: BrandDef = {
  categories: ["BBQ & Grill", "Karahi", "Rice & Bread", "Drinks", "Sweets"],
  groups: [
    { name: "Spice level", min: 1, max: 1, options: [{ name: "Mild", pkr: 0 }, { name: "Medium", pkr: 0 }, { name: "Hot", pkr: 0 }] },
    { name: "Sides", min: 0, max: 2, options: [{ name: "Raita", pkr: 90 }, { name: "Salad", pkr: 80 }, { name: "Mint chutney", pkr: 40 }] },
  ],
  products: [
    { name: "Chicken Tikka", category: "BBQ & Grill", description: "Charcoal-grilled marinated chicken pieces.", tags: ["HALAL", "BESTSELLER"], allergens: ["DAIRY"], station: "GRILL", variants: [{ name: "Quarter", pkr: 520 }, { name: "Half", pkr: 980 }], groups: ["Spice level", "Sides"] },
    { name: "Seekh Kebab", category: "BBQ & Grill", description: "Minced beef kebab with fresh herbs.", tags: ["HALAL", "SPICY"], station: "GRILL", variants: [{ name: "4 pieces", pkr: 760 }], groups: ["Spice level", "Sides"] },
    { name: "Beef Boti", category: "BBQ & Grill", tags: ["HALAL"], station: "GRILL", variants: [{ name: "Regular", pkr: 890 }], groups: ["Spice level", "Sides"] },
    { name: "Chicken Karahi", category: "Karahi", description: "Wok-cooked with tomato, ginger and green chilli.", tags: ["HALAL", "CHEFS_PICK"], allergens: ["DAIRY"], station: "GRILL", variants: [{ name: "Half", pkr: 1450 }, { name: "Full", pkr: 2650 }], groups: ["Spice level", "Sides"] },
    { name: "Mutton Karahi", category: "Karahi", tags: ["HALAL"], station: "GRILL", variants: [{ name: "Half", pkr: 2250 }, { name: "Full", pkr: 4200 }], groups: ["Spice level", "Sides"] },
    { name: "Chicken Biryani", category: "Rice & Bread", tags: ["HALAL", "SPICY"], station: "GRILL", variants: [{ name: "Single", pkr: 520 }, { name: "Family", pkr: 1850 }], groups: ["Spice level"] },
    { name: "Plain Naan", category: "Rice & Bread", tags: ["VEGETARIAN"], allergens: ["GLUTEN"], station: "GRILL", variants: [{ name: "Regular", pkr: 60 }] },
    { name: "Roghni Naan", category: "Rice & Bread", tags: ["VEGETARIAN"], allergens: ["GLUTEN", "SESAME"], station: "GRILL", variants: [{ name: "Regular", pkr: 90 }] },
    { name: "Mint Margarita", category: "Drinks", tags: ["VEGAN"], station: "BAR", variants: [{ name: "Regular", pkr: 320 }] },
    { name: "Lassi", category: "Drinks", tags: ["VEGETARIAN"], allergens: ["DAIRY"], station: "BAR", variants: [{ name: "Sweet", pkr: 350 }, { name: "Salted", pkr: 350 }] },
    { name: "Gulab Jamun", category: "Sweets", tags: ["VEGETARIAN"], allergens: ["DAIRY", "GLUTEN"], station: "GRILL", variants: [{ name: "2 pieces", pkr: 280 }] },
    { name: "Kheer", category: "Sweets", tags: ["VEGETARIAN", "GLUTEN_FREE"], allergens: ["DAIRY", "NUTS"], station: "GRILL", variants: [{ name: "Regular", pkr: 320 }] },
  ],
};

type Book = { id: string; currency: "PKR" | "AED" | "USD" };
/** Demo exchange rates, only to make three currencies look plausible. */
const FROM_PKR: Record<Book["currency"], number> = { PKR: 1, AED: 1 / 45, USD: 1 / 100 }; // menu prices in Dubai and Houston, not the market exchange rate
const minorIn = (pkr: number, currency: Book["currency"]) => {
  const minor = Math.round(pkr * 100 * FROM_PKR[currency]);
  return currency === "PKR" ? minor : Math.max(minor, 0) - (minor % 50 === 0 ? 0 : minor % 50); // tidy to the nearest 0.50
};

export interface DemoCatalogInput {
  tenantId: string;
  smashId: string;
  saffronId: string;
  books: Record<"PKR" | "AED" | "USD", string>;
  taxCategoryId: string;
  locations: { khi: string; lhe: string; dxb: string; hou: string };
}

export async function seedDemoCatalog(input: DemoCatalogInput): Promise<{ products: number; combos: number }> {
  const { tenantId } = input;
  const books: Book[] = (Object.entries(input.books) as [Book["currency"], string][]).map(([currency, id]) => ({ id, currency }));
  let productCount = 0;
  let comboCount = 0;

  const priceRows: Record<string, unknown>[] = [];
  const addPrice = (target: Record<string, string>, pkr: number, over: { books?: Book[]; channel?: "WEB"; compareAtPkr?: number } = {}) => {
    for (const b of over.books ?? books) {
      priceRows.push({
        id: randomUUID(), tenantId, ...target, priceBookId: b.id, channel: over.channel ?? null, currencyCode: b.currency, amountMinor: minorIn(pkr, b.currency),
        compareAtMinor: over.compareAtPkr ? minorIn(over.compareAtPkr, b.currency) : null,
      });
    }
  };

  const variantByProduct = new Map<string, Map<string, string>>(); // "Brand|Product" -> variant name -> id
  const productIdByName = new Map<string, string>();
  const optionIdByName = new Map<string, string>();

  for (const [brandId, brandKey, def] of [[input.smashId, "smash", SMASH], [input.saffronId, "saffron", SAFFRON]] as const) {
    const categoryIds = new Map(def.categories.map((c) => [c, randomUUID()]));
    await db.category.createMany({ data: def.categories.map((name, i) => ({ id: categoryIds.get(name)!, tenantId, brandId, name, sortOrder: i })) });

    // modifier groups and their options
    const groupIds = new Map<string, string>();
    const optionRows: Record<string, unknown>[] = [];
    for (const g of def.groups) {
      const id = randomUUID();
      groupIds.set(g.name, id);
      for (const [i, o] of g.options.entries()) {
        const optId = randomUUID();
        optionIdByName.set(`${brandKey}|${g.name}|${o.name}`, optId);
        optionRows.push({ id: optId, tenantId, groupId: id, name: o.name, isDefault: g.min > 0 && i === 0, sortOrder: i });
        if (o.pkr > 0) addPrice({ modifierOptionId: optId }, o.pkr);
      }
    }
    await db.modifierGroup.createMany({ data: def.groups.map((g) => ({ id: groupIds.get(g.name)!, tenantId, brandId, name: g.name, minSelect: g.min, maxSelect: g.max })) });
    await db.modifierOption.createMany({ data: optionRows as never });

    // products, variants, links
    const productRows: Record<string, unknown>[] = [];
    const variantRows: Record<string, unknown>[] = [];
    const linkRows: Record<string, unknown>[] = [];
    for (const [i, p] of def.products.entries()) {
      const id = randomUUID();
      productIdByName.set(`${brandKey}|${p.name}`, id);
      productRows.push({
        id, tenantId, brandId, categoryId: categoryIds.get(p.category)!, name: p.name, description: p.description ?? null, taxCategoryId: input.taxCategoryId,
        stationKey: p.station, tags: p.tags ?? [], allergens: p.allergens ?? [], sortOrder: i,
      });
      const vmap = new Map<string, string>();
      for (const [j, v] of p.variants.entries()) {
        const vid = randomUUID();
        vmap.set(v.name, vid);
        variantRows.push({ id: vid, tenantId, productId: id, name: v.name, isDefault: j === 0, sortOrder: j });
        addPrice({ variantId: vid }, v.pkr);
      }
      variantByProduct.set(`${brandKey}|${p.name}`, vmap);
      for (const [k, g] of (p.groups ?? []).entries()) linkRows.push({ tenantId, productId: id, modifierGroupId: groupIds.get(g)!, sortOrder: k });
    }
    await db.product.createMany({ data: productRows as never });
    await db.productVariant.createMany({ data: variantRows as never });
    if (linkRows.length) await db.productModifierGroup.createMany({ data: linkRows as never });
    productCount += productRows.length;
  }

  // combo: Smash Meal = any burger + fries + a drink, with an up-charge for a milkshake
  const burgerVariants = ["Classic Smash", "Cheese Smash", "Spicy Chicken Crunch"].map((n) => variantByProduct.get(`smash|${n}`)!.values().next().value as string);
  const comboId = randomUUID();
  await db.combo.create({ data: { id: comboId, tenantId, brandId: input.smashId, name: "Smash Meal", description: "Any single burger, fries and a drink.", taxCategoryId: input.taxCategoryId } });
  const slotIds = [randomUUID(), randomUUID(), randomUUID()];
  await db.comboSlot.createMany({ data: [{ id: slotIds[0]!, tenantId, comboId, name: "Burger", quantity: 1, sortOrder: 0 }, { id: slotIds[1]!, tenantId, comboId, name: "Side", quantity: 1, sortOrder: 1 }, { id: slotIds[2]!, tenantId, comboId, name: "Drink", quantity: 1, sortOrder: 2 }] });
  const cola = variantByProduct.get("smash|Cola")!.get("Can")!;
  const lemonade = variantByProduct.get("smash|Fresh Lemonade")!.get("Regular")!;
  const shake = variantByProduct.get("smash|Milkshake")!.get("Chocolate")!;
  const shakeOption = randomUUID();
  await db.comboSlotOption.createMany({
    data: [
      ...burgerVariants.map((variantId, i) => ({ id: randomUUID(), tenantId, slotId: slotIds[0]!, variantId, isDefault: i === 0 })),
      { id: randomUUID(), tenantId, slotId: slotIds[1]!, variantId: variantByProduct.get("smash|Fries")!.get("Regular")!, isDefault: true },
      { id: randomUUID(), tenantId, slotId: slotIds[2]!, variantId: cola, isDefault: true },
      { id: randomUUID(), tenantId, slotId: slotIds[2]!, variantId: lemonade, isDefault: false },
      { id: shakeOption, tenantId, slotId: slotIds[2]!, variantId: shake, isDefault: false },
    ],
  });
  addPrice({ comboId }, 1190, { compareAtPkr: 1370 });
  addPrice({ comboSlotOptionId: shakeOption }, 250);
  comboCount += 1;

  // a web-only price and a branch override, to show the resolution order in the admin
  addPrice({ variantId: variantByProduct.get("smash|Classic Smash")!.get("Single")! }, 940, { books: books.filter((b) => b.currency === "PKR"), channel: "WEB" });
  const cheeseSingle = variantByProduct.get("smash|Cheese Smash")!.get("Single")!;
  priceRows.push({ id: randomUUID(), tenantId, variantId: cheeseSingle, locationId: input.locations.khi, channel: null, currencyCode: "PKR", amountMinor: 99000, compareAtMinor: null });

  await db.price.createMany({ data: priceRows as never });

  // dayparts for Saffron Table: lunch and dinner (dinner runs past midnight)
  const saffronProducts = SAFFRON.products.map((p) => productIdByName.get(`saffron|${p.name}`)!);
  const lunch = randomUUID();
  const dinner = randomUUID();
  await db.menu.createMany({ data: [{ id: lunch, tenantId, brandId: input.saffronId, name: "Lunch" }, { id: dinner, tenantId, brandId: input.saffronId, name: "Dinner" }] });
  const everyDay = [0, 1, 2, 3, 4, 5, 6];
  await db.menuSchedule.createMany({ data: [{ tenantId, menuId: lunch, weekdays: everyDay, startsAt: "11:00", endsAt: "17:00" }, { tenantId, menuId: dinner, weekdays: everyDay, startsAt: "17:00", endsAt: "02:00" }] });
  const lunchItems = saffronProducts.filter((_, i) => i !== 3 && i !== 4); // no karahi at lunch
  await db.menuProduct.createMany({ data: [...lunchItems.map((productId, sortOrder) => ({ tenantId, menuId: lunch, productId, sortOrder })), ...saffronProducts.map((productId, sortOrder) => ({ tenantId, menuId: dinner, productId, sortOrder }))] });

  // availability: the fryer is down at Clifton, and Dubai does not sell beef bacon
  await db.locationAvailability.createMany({
    data: [
      { tenantId, locationId: input.locations.khi, productId: productIdByName.get("smash|Onion Rings")!, isAvailable: false },
      { tenantId, locationId: input.locations.dxb, modifierOptionId: optionIdByName.get("smash|Extras|Beef bacon")!, isListed: false },
    ],
  });

  return { products: productCount, combos: comboCount };
}
