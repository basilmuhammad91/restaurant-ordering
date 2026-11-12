import { describe, expect, it } from "vitest";
import {
  addToCart, discountPercent, itemCount, linesFromOrder, money, previewOrder, quickAmounts, setQuantity, toApiLines, type CartLine, type SellableMenu,
} from "../src/features/pos/cart";

const MENU: SellableMenu = {
  location: { id: "loc", name: "Karachi", timezone: "Asia/Karachi" },
  currencyCode: "PKR",
  tax: { pricesIncludeTax: false, rules: [{ ruleId: "r1", name: "SRB", authorityCode: "SRB", rateBp: 1300, taxCategoryId: "std", orderTypes: [], validFrom: null, validTo: null }] },
  categories: [{
    id: "c1", name: "Food", imageUrl: null, sortOrder: 0,
    products: [{
      id: "p1", name: "Burger", description: null, imageUrl: null, tags: [], allergens: [], stationKey: "GRILL", taxCategoryId: "std",
      variants: [{ id: "v1", name: "Single", isDefault: true, priceMinor: 100_000, compareAtMinor: null }, { id: "v2", name: "Double", isDefault: false, priceMinor: 200_000, compareAtMinor: null }],
      modifierGroups: [{ id: "g1", name: "Extras", minSelect: 0, maxSelect: 2, options: [{ id: "o1", name: "Cheese", isDefault: false, priceMinor: 8_000 }] }],
    }],
  }],
  combos: [{ id: "cb1", name: "Meal", description: null, imageUrl: null, taxCategoryId: "std", priceMinor: 180_000, compareAtMinor: null, slots: [{ id: "s1", name: "Drink", quantity: 1, options: [{ id: "so1", variantId: "v1", productName: "Burger", variantName: "Single", name: "Burger (Single)", isDefault: true, upchargeMinor: 0 }] }] }],
};

const line = (over: Partial<CartLine> = {}): CartLine => ({
  key: crypto.randomUUID(), kind: "item", variantId: "v1", name: "Burger", variantName: "Single", imageUrl: null, quantity: 1, unitMinor: 100_000, modifiers: [], choices: [], notes: "", taxCategoryId: "std", ...over,
});

describe("the basket", () => {
  it("adding the same thing again raises the quantity; different add-ons or notes make a new row", () => {
    const a = addToCart([], line());
    const b = addToCart(a, line());
    expect(b).toHaveLength(1);
    expect(b[0]!.quantity).toBe(2);
    expect(addToCart(b, line({ modifiers: [{ id: "o1", name: "Cheese", priceMinor: 8_000 }], unitMinor: 108_000 }))).toHaveLength(2);
    expect(addToCart(b, line({ notes: "no onion" }))).toHaveLength(2);
    expect(addToCart(b, line({ variantId: "v2" }))).toHaveLength(2);
  });

  it("the order of add-ons does not matter", () => {
    const x = line({ modifiers: [{ id: "a", name: "A", priceMinor: 1 }, { id: "b", name: "B", priceMinor: 1 }] });
    const y = line({ modifiers: [{ id: "b", name: "B", priceMinor: 1 }, { id: "a", name: "A", priceMinor: 1 }] });
    expect(addToCart([x], y)).toHaveLength(1);
  });

  it("quantities change, never below 1, and zero removes the row; capped at 100", () => {
    const [l] = addToCart([], line());
    expect(setQuantity([l!], l!.key, 5)[0]!.quantity).toBe(5);
    expect(setQuantity([l!], l!.key, 0)).toHaveLength(0);
    expect(setQuantity([l!], l!.key, 250)[0]!.quantity).toBe(100);
    expect(itemCount([line({ quantity: 2 }), line({ quantity: 3, variantId: "v2" })])).toBe(5);
  });

  it("sends only ids and quantities to the server, never prices", () => {
    const body = toApiLines([line({ quantity: 2, modifiers: [{ id: "o1", name: "Cheese", priceMinor: 8_000 }], unitMinor: 108_000, notes: " no onion " })]);
    expect(body).toEqual([{ kind: "item", variantId: "v1", quantity: 2, modifierOptionIds: ["o1"], notes: "no onion" }]);
    expect(JSON.stringify(body)).not.toMatch(/108000|unitMinor|priceMinor/);
    const combo = toApiLines([line({ kind: "combo", variantId: undefined, comboId: "cb1", choices: [{ slotId: "s1", optionId: "so1", name: "Burger (Single)" }] })]);
    expect(combo[0]).toEqual({ kind: "combo", comboId: "cb1", quantity: 1, choices: [{ slotId: "s1", optionId: "so1" }], notes: null });
  });
});

describe("totals on the screen match the server's maths", () => {
  it("adds 13% on top, per line", () => {
    const p = previewOrder([line({ quantity: 2, unitMinor: 211_000 }), line({ variantId: "v3", unitMinor: 30_000 })], MENU, "TAKEAWAY", null, 0);
    expect(p.subtotalMinor).toBe(452_000);
    expect(p.taxMinor).toBe(54_860 + 3_900);
    expect(p.totalMinor).toBe(452_000 + 58_760);
  });

  it("applies a percent discount before tax, and an amount discount capped at the order", () => {
    const lines = [line({ unitMinor: 100_000 })];
    expect(previewOrder(lines, MENU, "TAKEAWAY", { type: "PERCENT", value: 10, reasonId: "r", note: "" }, 0)).toMatchObject({ discountMinor: 10_000, taxMinor: 11_700, totalMinor: 101_700 });
    expect(previewOrder(lines, MENU, "TAKEAWAY", { type: "AMOUNT", value: 999_999, reasonId: "r", note: "" }, 0)).toMatchObject({ discountMinor: 100_000, totalMinor: 0 });
  });

  it("charges delivery only for delivery orders, and does not tax it", () => {
    expect(previewOrder([line()], MENU, "TAKEAWAY", null, 15_000).totalMinor).toBe(113_000);
    expect(previewOrder([line()], MENU, "DELIVERY", null, 15_000).totalMinor).toBe(113_000 + 15_000);
  });

  it("tax already inside the price leaves the total unchanged", () => {
    const inclusive: SellableMenu = { ...MENU, tax: { pricesIncludeTax: true, rules: [{ ruleId: "v", name: "VAT", authorityCode: "FTA", rateBp: 500, taxCategoryId: null, orderTypes: [], validFrom: null, validTo: null }] } };
    const p = previewOrder([line({ unitMinor: 10_500 })], inclusive, "TAKEAWAY", null, 0);
    expect(p.totalMinor).toBe(10_500);
    expect(p.taxMinor).toBe(500);
  });

  it("no tax rules means no tax, and a rule only for one order type applies only to it", () => {
    expect(previewOrder([line()], { ...MENU, tax: null }, "TAKEAWAY", null, 0).taxMinor).toBe(0);
    const dineOnly: SellableMenu = { ...MENU, tax: { pricesIncludeTax: false, rules: [{ ...MENU.tax!.rules[0]!, orderTypes: ["DINE_IN"] }] } };
    expect(previewOrder([line()], dineOnly, "TAKEAWAY", null, 0).taxMinor).toBe(0);
    expect(previewOrder([line()], dineOnly, "DINE_IN", null, 0).taxMinor).toBe(13_000);
  });

  it("an empty basket is worth nothing", () => {
    expect(previewOrder([], MENU, "TAKEAWAY", null, 0).totalMinor).toBe(0);
  });

  it("an amount discount's equivalent percentage is what limits are checked against", () => {
    expect(discountPercent({ type: "AMOUNT", value: 5_000, reasonId: "r", note: "" }, 100_000)).toBe(5);
    expect(discountPercent({ type: "PERCENT", value: 12.5, reasonId: "r", note: "" }, 100_000)).toBe(12.5);
    expect(discountPercent({ type: "AMOUNT", value: 5_000, reasonId: "r", note: "" }, 0)).toBe(0);
  });
});

describe("money on the till", () => {
  it("shows whole amounts without decimals and others with them", () => {
    const f = { symbol: "Rs.", exponent: 2 };
    expect(money(125_000, f)).toBe("Rs. 1,250");
    expect(money(125_050, f)).toBe("Rs. 1,250.50");
    expect(money(0, f)).toBe("Rs. 0");
    expect(money(7, f)).toBe("Rs. 0.07");
    expect(money(1_234, { symbol: "KD", exponent: 3 })).toBe("KD 1.234");
    expect(money(500, { symbol: "¥", exponent: 0 })).toBe("¥ 500");
  });

  it("offers the exact amount and the next round notes for cash", () => {
    const q = quickAmounts(87_300, 2);
    expect(q[0]).toBe(87_300); // exact first
    expect(q.every((n) => n >= 87_300)).toBe(true);
    expect(new Set(q).size).toBe(q.length);
    expect(q).toContain(100_000);
    expect(quickAmounts(100_000, 2)[0]).toBe(100_000);
  });
});

describe("reopening a held bill", () => {
  it("rebuilds the basket from the saved order and reports anything no longer sold", () => {
    const saved = [
      { kind: "ITEM" as const, status: "NEW", variantId: "v2", comboId: null, quantity: 2, notes: null, modifiers: [{ optionId: "o1" }] },
      { kind: "ITEM" as const, status: "NEW", variantId: "gone", comboId: null, quantity: 1, notes: null, modifiers: [] },
      { kind: "ITEM" as const, status: "VOIDED", variantId: "v1", comboId: null, quantity: 1, notes: null, modifiers: [] },
      { kind: "COMBO" as const, status: "NEW", variantId: null, comboId: "cb1", quantity: 1, notes: "extra napkins", modifiers: [], children: [{ variantId: "v1" }] },
    ];
    const { lines, missing } = linesFromOrder(saved, MENU);
    expect(missing).toBe(1);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ variantId: "v2", variantName: "Double", quantity: 2, unitMinor: 208_000 });
    expect(lines[1]).toMatchObject({ kind: "combo", comboId: "cb1", notes: "extra napkins", choices: [{ slotId: "s1", optionId: "so1" }] });
  });
});
