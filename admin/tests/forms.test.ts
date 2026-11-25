import { describe, expect, it } from "vitest";
import { clean as cleanCombo } from "../src/features/menu/CombosPage";
import { clean as cleanProduct } from "../src/features/menu/ProductsPage";

const product = {
  brandId: "b", categoryId: "c", name: "Beef Boti", description: "", imageUrl: " https://example.com/a.jpg ", sku: "", taxCategoryId: "", stationKey: "",
  tags: [], allergens: [], isActive: true, variants: [{ name: "Regular", sku: "", isDefault: true }], modifierGroups: [],
};

describe("menu form values", () => {
  it("empty boxes become null and text is trimmed", () => {
    expect(cleanProduct(product)).toMatchObject({ description: null, sku: null, imageUrl: "https://example.com/a.jpg", variants: [{ sku: null }] });
  });

  it("can be applied to its own output, which is what happens on save (this used to crash on null.trim)", () => {
    const once = cleanProduct(product);
    expect(cleanProduct(once as never)).toEqual(once);
    const combo = { brandId: "b", name: "Meal", description: "", imageUrl: "", taxCategoryId: "", isActive: true, startsAt: "", endsAt: "", slots: [] };
    const comboOnce = cleanCombo(combo);
    expect(cleanCombo(comboOnce as never)).toEqual(comboOnce);
  });
});
