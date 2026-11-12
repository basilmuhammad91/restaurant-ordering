import {
  priceOrder, selectTaxRules, toBasisPoints, type OrderDiscountInput, type OrderLineInputBody, type PricedOrder, type TaxRuleRow,
} from "@restoflux/contracts";

// The till's basket. Totals shown on screen come from the SAME functions the server uses (priceOrder and
// selectTaxRules in @restoflux/contracts), so what the cashier sees is what the order will be. The server still
// prices every order itself and never trusts these numbers.

// ---- the sellable menu, as the API returns it ----
export interface MenuVariant { id: string; name: string; isDefault: boolean; priceMinor: number; compareAtMinor: number | null }
export interface MenuOption { id: string; name: string; isDefault: boolean; priceMinor: number }
export interface MenuGroup { id: string; name: string; minSelect: number; maxSelect: number; options: MenuOption[] }
export interface MenuProduct {
  id: string; name: string; description: string | null; imageUrl: string | null; tags: string[]; allergens: string[]; stationKey: string | null; taxCategoryId: string | null;
  variants: MenuVariant[]; modifierGroups: MenuGroup[];
}
export interface MenuCategory { id: string; name: string; imageUrl: string | null; sortOrder: number; products: MenuProduct[] }
export interface MenuSlotOption { id: string; variantId: string; productName: string; variantName: string; name: string; isDefault: boolean; upchargeMinor: number }
export interface MenuCombo {
  id: string; name: string; description: string | null; imageUrl: string | null; taxCategoryId: string | null; priceMinor: number; compareAtMinor: number | null;
  slots: { id: string; name: string; quantity: number; options: MenuSlotOption[] }[];
}
export interface SellableMenu {
  location: { id: string; name: string; timezone: string };
  currencyCode: string;
  tax: { pricesIncludeTax: boolean; rules: TaxRuleRow[] } | null;
  categories: MenuCategory[];
  combos: MenuCombo[];
}

// ---- the basket ----
export interface CartLine {
  key: string;
  kind: "item" | "combo";
  variantId?: string;
  comboId?: string;
  name: string;
  variantName: string | null;
  imageUrl: string | null;
  quantity: number;
  /** price of ONE unit including add-ons and up-charges */
  unitMinor: number;
  modifiers: { id: string; name: string; priceMinor: number }[];
  choices: { slotId: string; optionId: string; name: string }[];
  notes: string;
  taxCategoryId: string | null;
}

export const newKey = () => crypto.randomUUID();

const configOf = (l: CartLine) =>
  JSON.stringify([l.kind, l.variantId, l.comboId, l.modifiers.map((m) => m.id).sort(), l.choices.map((c) => `${c.slotId}:${c.optionId}`).sort(), l.notes.trim()]);

/** Adding the same thing again raises the quantity instead of making a second row. */
export function addToCart(lines: CartLine[], line: CartLine): CartLine[] {
  const same = lines.find((l) => configOf(l) === configOf(line));
  if (!same) return [...lines, line];
  return lines.map((l) => (l.key === same.key ? { ...l, quantity: Math.min(l.quantity + line.quantity, 100) } : l));
}

export const setQuantity = (lines: CartLine[], key: string, quantity: number): CartLine[] =>
  quantity <= 0 ? lines.filter((l) => l.key !== key) : lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(quantity, 100) } : l));

export const itemCount = (lines: CartLine[]) => lines.reduce((a, l) => a + l.quantity, 0);

/** The lines in the shape the API wants: ids and quantities only. */
export function toApiLines(lines: CartLine[]): OrderLineInputBody[] {
  return lines.map((l) =>
    l.kind === "item"
      ? { kind: "item", variantId: l.variantId!, quantity: l.quantity, modifierOptionIds: l.modifiers.map((m) => m.id), notes: l.notes.trim() || null }
      : { kind: "combo", comboId: l.comboId!, quantity: l.quantity, choices: l.choices.map((c) => ({ slotId: c.slotId, optionId: c.optionId })), notes: l.notes.trim() || null },
  );
}

export interface DiscountDraft {
  type: "PERCENT" | "AMOUNT"; /** percent, or minor units */ value: number; reasonId: string; note: string;
  /** Set when the discount is a coupon or promotion: the server then decides the amount itself. */
  offer?: { couponCode?: string; promotionId?: string }; label?: string;
}

/** Totals as the server will compute them. */
export function previewOrder(lines: CartLine[], menu: SellableMenu | undefined, orderType: string, discount: DiscountDraft | null, deliveryFeeMinor: number): PricedOrder {
  const at = new Date();
  const d: OrderDiscountInput | null = discount ? (discount.type === "PERCENT" ? { type: "PERCENT", percentBp: toBasisPoints(discount.value) } : { type: "AMOUNT", amountMinor: Math.round(discount.value) }) : null;
  return priceOrder({
    lines: lines.map((l) => ({ key: l.key, unitMinor: l.unitMinor, quantity: l.quantity, taxRules: menu?.tax ? selectTaxRules(menu.tax.rules, l.taxCategoryId, orderType, at) : [] })),
    pricesIncludeTax: menu?.tax?.pricesIncludeTax ?? false,
    discount: d,
    deliveryFeeMinor: orderType === "DELIVERY" ? deliveryFeeMinor : 0,
  });
}

/** Does the discount percentage (or the equivalent of an amount) go past what this person may give? */
export const discountPercent = (d: DiscountDraft, subtotalMinor: number): number => (d.type === "PERCENT" ? d.value : subtotalMinor > 0 ? (d.value / subtotalMinor) * 100 : 0);

// ---- money for the till ----
export interface MoneyFormat { symbol: string; exponent: number }
/** "Rs. 1,250" (no decimals when there are none to show) or "Rs. 1,250.50". */
export function money(minor: number, f: MoneyFormat): string {
  const value = minor / 10 ** f.exponent;
  const whole = Number.isInteger(value);
  const text = new Intl.NumberFormat("en", { minimumFractionDigits: whole ? 0 : f.exponent, maximumFractionDigits: f.exponent }).format(value);
  return `${f.symbol} ${text}`;
}

// ---- building cart lines from menu entries ----
export function lineForProduct(p: MenuProduct, variant: MenuVariant, mods: MenuOption[], quantity: number, notes: string): CartLine {
  return {
    key: newKey(), kind: "item", variantId: variant.id, name: p.name, variantName: p.variants.length > 1 ? variant.name : null, imageUrl: p.imageUrl,
    quantity, unitMinor: variant.priceMinor + mods.reduce((a, m) => a + m.priceMinor, 0), modifiers: mods.map((m) => ({ id: m.id, name: m.name, priceMinor: m.priceMinor })),
    choices: [], notes, taxCategoryId: p.taxCategoryId,
  };
}

export function lineForCombo(c: MenuCombo, picks: { slotId: string; option: MenuSlotOption }[], quantity: number, notes: string): CartLine {
  return {
    key: newKey(), kind: "combo", comboId: c.id, name: c.name, variantName: null, imageUrl: c.imageUrl, quantity, unitMinor: c.priceMinor + picks.reduce((a, p) => a + p.option.upchargeMinor, 0),
    modifiers: [], choices: picks.map((p) => ({ slotId: p.slotId, optionId: p.option.id, name: p.option.name })), notes, taxCategoryId: c.taxCategoryId,
  };
}

/** Rebuild basket lines from a saved (held) order so it can be edited. Anything no longer sold is reported, not guessed. */
export interface SavedLine {
  kind: "ITEM" | "COMBO" | "COMBO_ITEM"; status: string; variantId: string | null; comboId: string | null; quantity: number; notes: string | null;
  modifiers: { optionId: string }[]; children?: { variantId: string | null }[];
}
export function linesFromOrder(saved: SavedLine[], menu: SellableMenu): { lines: CartLine[]; missing: number } {
  const lines: CartLine[] = [];
  let missing = 0;
  for (const s of saved.filter((x) => x.status !== "VOIDED")) {
    if (s.kind === "ITEM") {
      const product = menu.categories.flatMap((c) => c.products).find((p) => p.variants.some((v) => v.id === s.variantId));
      const variant = product?.variants.find((v) => v.id === s.variantId);
      if (!product || !variant) { missing++; continue; }
      const options = product.modifierGroups.flatMap((g) => g.options);
      const mods = s.modifiers.map((m) => options.find((o) => o.id === m.optionId)).filter((o): o is MenuOption => !!o);
      lines.push(lineForProduct(product, variant, mods, s.quantity, s.notes ?? ""));
    } else if (s.kind === "COMBO") {
      const combo = menu.combos.find((c) => c.id === s.comboId);
      if (!combo) { missing++; continue; }
      const used = [...(s.children ?? [])];
      const picks = combo.slots.flatMap((slot) =>
        Array.from({ length: slot.quantity }, () => {
          const idx = used.findIndex((u) => slot.options.some((o) => o.variantId === u.variantId));
          const child = idx >= 0 ? used.splice(idx, 1)[0] : undefined;
          const option = slot.options.find((o) => o.variantId === child?.variantId) ?? slot.options.find((o) => o.isDefault) ?? slot.options[0]!;
          return { slotId: slot.id, option };
        }),
      );
      lines.push(lineForCombo(combo, picks, s.quantity, s.notes ?? ""));
    }
  }
  return { lines, missing };
}

/** Quick cash amounts: exactly what is due, then the next round notes above it. */
export function quickAmounts(dueMinor: number, exponent: number): number[] {
  const unit = 10 ** exponent;
  const steps = [100, 500, 1000, 5000].map((n) => n * unit);
  const out = [dueMinor, ...steps.map((s) => Math.ceil(dueMinor / s) * s)];
  return [...new Set(out)].filter((n) => n >= dueMinor).slice(0, 4);
}

