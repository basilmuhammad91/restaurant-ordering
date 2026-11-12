import {
  priceOrder, selectTaxRules, toBasisPoints, type OrderCreateInput, type OrderDiscountInput, type PriceChannel, type PricedOrder, type TaxRuleInput,
} from "@restoflux/contracts";
import { randomUUID } from "node:crypto";
import { fieldError } from "../../core/http/errors.js";
import { buildSellableMenu, type SellableCombo, type SellableProduct, type SellableVariant } from "../catalog/availability.js";

// THE ORDER ENGINE. Turns "what the customer asked for" (ids and quantities) into a priced, taxed order
// that is a SNAPSHOT: names, prices and tax rates are copied onto it, so later menu or tax changes never alter it.
// Prices and taxes are NEVER taken from the client: everything is looked up in the branch's sellable menu
// (the same data the POS shows) and calculated with the shared money functions.
// (Laravel: the CheckoutService that freezes an invoice.)

export type Menu = Awaited<ReturnType<typeof buildSellableMenu>>;

export interface LineDraft {
  id: string;
  parentLineId: string | null;
  kind: "ITEM" | "COMBO" | "COMBO_ITEM";
  variantId: string | null;
  comboId: string | null;
  name: string;
  variantName: string | null;
  quantity: number;
  unitPriceMinor: number;
  modifiersTotalMinor: number;
  stationKey: string | null;
  notes: string | null;
  sortOrder: number;
  modifiers: { optionId: string; name: string; priceMinor: number }[];
  taxRules: TaxRuleInput[];
}

export interface OrderDraft {
  menu: Menu;
  lines: LineDraft[];
  priced: PricedOrder;
  pricesIncludeTax: boolean;
  discountInput: OrderDiscountInput | null;
}

/** Tax rules for a product at this branch (the same function the POS uses to preview totals). */
export const rulesFor = (menu: Menu, taxCategoryId: string | null, orderType: string, at: Date): TaxRuleInput[] =>
  menu.tax ? selectTaxRules(menu.tax.rules, taxCategoryId, orderType, at) : [];

function findVariant(menu: Menu, variantId: string): { product: SellableProduct; variant: SellableVariant } | null {
  for (const c of menu.categories) for (const p of c.products) {
    const v = p.variants.find((x) => x.id === variantId);
    if (v) return { product: p, variant: v };
  }
  return null;
}

type DraftInput = Pick<OrderCreateInput, "locationId" | "orderType" | "channel" | "lines" | "deliveryFeeMinor" | "discount">;

/** Price an order request against the branch's menu. Throws a field error for anything that cannot be sold. */
export async function draftOrder(input: DraftInput, at: Date): Promise<OrderDraft> {
  const menu = await buildSellableMenu({ locationId: input.locationId, channel: input.channel as PriceChannel, at: at.toISOString() });
  return draftFromMenu(menu, input, at);
}

/** The same, on a menu that is already loaded (the demo-data seed prices hundreds of orders without a query each). */
export function draftFromMenu(menu: Menu, input: DraftInput, at: Date): OrderDraft {
  const lines: LineDraft[] = [];
  let sort = 0;

  for (const [index, l] of input.lines.entries()) {
    const where = `Line ${index + 1}`;
    if (l.kind === "item") {
      const found = findVariant(menu, l.variantId);
      if (!found) throw fieldError("lines", `${where}: that item is not available at this branch right now`);
      const { product, variant } = found;

      // modifier options must belong to one of the product's groups, once each, and respect min/max
      const chosen = new Map<string, { optionId: string; name: string; priceMinor: number; groupId: string }>();
      for (const optionId of l.modifierOptionIds) {
        if (chosen.has(optionId)) throw fieldError("lines", `${where}: an add-on was chosen twice`);
        const group = product.modifierGroups.find((g) => g.options.some((o) => o.id === optionId));
        const option = group?.options.find((o) => o.id === optionId);
        if (!group || !option) throw fieldError("lines", `${where}: an add-on is not available for ${product.name}`);
        chosen.set(optionId, { optionId, name: option.name, priceMinor: option.priceMinor, groupId: group.id });
      }
      for (const g of product.modifierGroups) {
        const count = [...chosen.values()].filter((c) => c.groupId === g.id).length;
        if (count < g.minSelect) throw fieldError("lines", `${where}: choose ${g.minSelect === 1 ? "one" : `at least ${g.minSelect}`} for "${g.name}"`);
        if (count > g.maxSelect) throw fieldError("lines", `${where}: "${g.name}" allows at most ${g.maxSelect}`);
      }

      const modifiersTotal = [...chosen.values()].reduce((a, c) => a + c.priceMinor, 0);
      lines.push({
        id: randomUUID(), parentLineId: null, kind: "ITEM", variantId: variant.id, comboId: null, name: product.name, variantName: product.variants.length > 1 ? variant.name : null,
        quantity: l.quantity, unitPriceMinor: variant.priceMinor + modifiersTotal, modifiersTotalMinor: modifiersTotal, stationKey: product.stationKey, notes: l.notes ?? null, sortOrder: sort++,
        modifiers: [...chosen.values()].map(({ optionId, name, priceMinor }) => ({ optionId, name, priceMinor })),
        taxRules: rulesFor(menu, product.taxCategoryId, input.orderType, at),
      });
      continue;
    }

    // combo: pick the option of each slot, price = combo price + up-charges, children carry stock and station
    const combo: SellableCombo | undefined = menu.combos.find((c) => c.id === l.comboId);
    if (!combo) throw fieldError("lines", `${where}: that combo is not available at this branch right now`);
    const picks: { slotId: string; option: SellableCombo["slots"][number]["options"][number] }[] = [];
    for (const slot of combo.slots) {
      const asked = l.choices.filter((c) => c.slotId === slot.id);
      const optionsAsked = asked.length > 0 ? asked.map((c) => c.optionId) : slot.options.length === 1 ? Array(slot.quantity).fill(slot.options[0]!.id) : [];
      if (optionsAsked.length !== slot.quantity) throw fieldError("lines", `${where}: choose ${slot.quantity} for "${slot.name}"`);
      for (const optionId of optionsAsked) {
        const option = slot.options.find((o) => o.id === optionId);
        if (!option) throw fieldError("lines", `${where}: that choice is not part of "${slot.name}"`);
        picks.push({ slotId: slot.id, option });
      }
    }
    if (l.choices.some((c) => !combo.slots.some((s) => s.id === c.slotId))) throw fieldError("lines", `${where}: unknown slot`);

    const upcharge = picks.reduce((a, p) => a + p.option.upchargeMinor, 0);
    const parentId = randomUUID();
    lines.push({
      id: parentId, parentLineId: null, kind: "COMBO", variantId: null, comboId: combo.id, name: combo.name, variantName: null, quantity: l.quantity,
      unitPriceMinor: combo.priceMinor + upcharge, modifiersTotalMinor: upcharge, stationKey: null, notes: l.notes ?? null, sortOrder: sort++, modifiers: [],
      taxRules: rulesFor(menu, combo.taxCategoryId, input.orderType, at),
    });
    for (const p of picks) {
      lines.push({
        id: randomUUID(), parentLineId: parentId, kind: "COMBO_ITEM", variantId: p.option.variantId, comboId: null, name: p.option.productName, variantName: p.option.variantName,
        quantity: l.quantity, unitPriceMinor: 0, modifiersTotalMinor: 0, stationKey: p.option.stationKey, notes: null, sortOrder: sort++, modifiers: [], taxRules: [],
      });
    }
  }

  const discount = input.discount ? toDiscount(input.discount) : null;
  const pricedLines = lines.filter((l) => l.kind !== "COMBO_ITEM");
  const priced = priceOrder({
    lines: pricedLines.map((l) => ({ key: l.id, unitMinor: l.unitPriceMinor, quantity: l.quantity, taxRules: l.taxRules })),
    pricesIncludeTax: menu.tax?.pricesIncludeTax ?? false,
    discount,
    deliveryFeeMinor: input.orderType === "DELIVERY" ? input.deliveryFeeMinor ?? 0 : 0,
  });
  return { menu, lines, priced, pricesIncludeTax: menu.tax?.pricesIncludeTax ?? false, discountInput: discount };
}

/** A discount as the client sent it (percent like 12.5, or minor units) to the maths' form (basis points / minor). */
export function toDiscount(d: { type: "PERCENT" | "AMOUNT"; value: number }): OrderDiscountInput {
  return d.type === "PERCENT" ? { type: "PERCENT", percentBp: toBasisPoints(d.value) } : { type: "AMOUNT", amountMinor: Math.round(d.value) };
}
