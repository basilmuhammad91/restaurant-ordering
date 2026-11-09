import { availabilityUpdateSchema, idSchema, isScheduled, isSellableNow, resolvePrice, sellableQuerySchema, toBasisPoints, type PriceChannel, type ResolvablePrice } from "@restoflux/contracts";
import { z } from "zod";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext } from "../../core/context/context.js";
import { db } from "../../core/db/scoped.js";
import { notFound } from "../../core/http/errors.js";
import { securedRouter } from "../../core/http/secured.js";

// BRANCH AVAILABILITY ("86") and the SELLABLE MENU.
//   availability: which items a branch sells and which are sold out right now. A sold-out flag takes
//     effect on the very next read, so the POS and the storefront never show what the kitchen ran out of.
//   sellable: the one place that answers "what can this branch sell right now, in this channel, at what
//     price". It applies: active item, a menu being served now, a price, not unlisted, not 86'd.
//     The POS (Phase 3) and the storefront both call it, so they can never disagree.

const availability = securedRouter("/api/v1/availability");

const listQuery = z.object({ locationId: idSchema, q: z.string().trim().max(100).optional() });

availability.get("/", "menu.view", async (req, res) => {
  const { locationId, q } = listQuery.parse(req.query);
  const location = await db.location.findFirst({ where: { id: locationId }, select: { id: true, name: true, brandId: true, type: true } });
  if (!location) throw notFound("location");
  if (!location.brandId) return res.json({ data: [] });

  const search = q ? { name: { contains: q, mode: "insensitive" as const } } : {};
  const [products, combos, rows] = await Promise.all([
    db.product.findMany({ where: { brandId: location.brandId, isActive: true, ...search }, select: { id: true, name: true, imageUrl: true, category: { select: { name: true, sortOrder: true } } }, orderBy: { name: "asc" } }),
    db.combo.findMany({ where: { brandId: location.brandId, isActive: true, ...search }, select: { id: true, name: true, imageUrl: true }, orderBy: { name: "asc" } }),
    db.locationAvailability.findMany({ where: { locationId } }),
  ]);
  const state = new Map(rows.map((r) => [r.productId ?? r.comboId ?? r.modifierOptionId!, r]));
  const now = new Date();
  const shape = (kind: "product" | "combo", row: { id: string; name: string; imageUrl: string | null }, category: string) => {
    const s = state.get(row.id);
    return {
      kind, id: row.id, name: row.name, imageUrl: row.imageUrl, category,
      isListed: s?.isListed ?? true, isAvailable: s?.isAvailable ?? true, soldOutUntil: s?.soldOutUntil ?? null,
      sellable: isSellableNow(s ?? null, now),
    };
  };
  res.json({ data: [...products.map((p) => shape("product", p, p.category.name)), ...combos.map((c) => shape("combo", c, "Combos"))] });
});

availability.put("/", "menu.availability.toggle", async (req, res) => {
  const input = availabilityUpdateSchema.parse(req.body);
  const ctx = requireContext();
  const key = "productId" in input.target ? "productId" : "comboId" in input.target ? "comboId" : "modifierOptionId";
  const targetId = (input.target as Record<string, string>)[key]!;

  const row = await db.$transaction(async (tx) => {
    const location = await tx.location.findFirst({ where: { id: input.locationId } });
    if (!location) throw notFound("location"); // also what a user outside this branch's scope gets
    const exists =
      key === "productId" ? await tx.product.findFirst({ where: { id: targetId, brandId: location.brandId ?? undefined } })
      : key === "comboId" ? await tx.combo.findFirst({ where: { id: targetId, brandId: location.brandId ?? undefined } })
      : await tx.modifierOption.findFirst({ where: { id: targetId, deletedAt: null, group: { brandId: location.brandId ?? undefined } } });
    if (!exists) throw notFound("item");

    const before = await tx.locationAvailability.findFirst({ where: { locationId: location.id, [key]: targetId } });
    const data = {
      ...(input.isListed !== undefined && { isListed: input.isListed }),
      ...(input.isAvailable !== undefined && { isAvailable: input.isAvailable }),
      // turning an item back on clears any timer; a timer is only kept while it is sold out
      soldOutUntil: input.isAvailable === true ? null : input.soldOutUntil !== undefined ? (input.soldOutUntil ? new Date(input.soldOutUntil) : null) : before?.soldOutUntil ?? null,
      updatedById: ctx.userId,
    };
    const after = before
      ? await tx.locationAvailability.update({ where: { id: before.id }, data })
      : await tx.locationAvailability.create({ data: { tenantId: ctx.tenantId, locationId: location.id, [key]: targetId, ...data } });
    await recordAudit(tx, {
      action: input.isAvailable === false ? "availability.86" : input.isAvailable === true ? "availability.restock" : "availability.update",
      entityType: "LocationAvailability", entityId: after.id, locationId: location.id,
      before: before ? { isListed: before.isListed, isAvailable: before.isAvailable, soldOutUntil: before.soldOutUntil } : null,
      after: { [key]: targetId, isListed: after.isListed, isAvailable: after.isAvailable, soldOutUntil: after.soldOutUntil },
    });
    return after;
  });
  res.json({ data: row });
});

/** End of day: put everything that was 86'd back on the menu for one branch. */
availability.post("/reset", "menu.availability.toggle", async (req, res) => {
  const { locationId } = z.object({ locationId: idSchema }).parse(req.body);
  const ctx = requireContext();
  const count = await db.$transaction(async (tx) => {
    const location = await tx.location.findFirst({ where: { id: locationId } });
    if (!location) throw notFound("location");
    const { count } = await tx.locationAvailability.updateMany({ where: { locationId, isAvailable: false }, data: { isAvailable: true, soldOutUntil: null, updatedById: ctx.userId } });
    await recordAudit(tx, { action: "availability.reset", entityType: "Location", entityId: locationId, locationId, after: { restocked: count } });
    return count;
  });
  res.json({ data: { restocked: count } });
});

export const availabilityRouter = availability.router;

// ---------------------------------------------------------------- sellable menu
const catalog = securedRouter("/api/v1/catalog");

type PriceRow = ResolvablePrice & { targetId: string };

// The shapes buildSellableMenu returns (the order engine looks things up in them).
export interface SellableVariant { id: string; name: string; isDefault: boolean; priceMinor: number; compareAtMinor: number | null }
export interface SellableOption { id: string; name: string; isDefault: boolean; priceMinor: number }
export interface SellableGroup { id: string; name: string; minSelect: number; maxSelect: number; options: SellableOption[] }
export interface SellableProduct {
  id: string; name: string; description: string | null; imageUrl: string | null; tags: string[]; allergens: string[]; stationKey: string | null; taxCategoryId: string | null;
  variants: SellableVariant[]; modifierGroups: SellableGroup[];
}
export interface SellableCategory { id: string; name: string; imageUrl: string | null; sortOrder: number; products: SellableProduct[] }
export interface SellableSlotOption { id: string; variantId: string; productName: string; variantName: string; stationKey: string | null; taxCategoryId: string | null; name: string; isDefault: boolean; upchargeMinor: number }
export interface SellableCombo {
  id: string; name: string; description: string | null; imageUrl: string | null; taxCategoryId: string | null; priceMinor: number; compareAtMinor: number | null;
  slots: { id: string; name: string; quantity: number; options: SellableSlotOption[] }[];
}

/**
 * What a branch can sell right now. The ONE source for the POS screen, the storefront AND the order engine
 * (an order is priced from this, never from numbers the client sends), so they can never disagree.
 */
export async function buildSellableMenu(q: { locationId: string; channel?: PriceChannel | undefined; at?: string | undefined }) {
  const channel = (q.channel ?? null) as PriceChannel | null;
  const now = q.at ? new Date(q.at) : new Date();

  const location = await db.location.findFirst({ where: { id: q.locationId }, select: { id: true, name: true, brandId: true, currencyCode: true, timezone: true, priceBookId: true, taxProfileId: true, type: true } });
  if (!location) throw notFound("location");
  if (!location.brandId || !location.priceBookId) {
    return { location: { id: location.id, name: location.name, timezone: location.timezone }, currencyCode: location.currencyCode, channel, at: now.toISOString(), tax: null, categories: [] as SellableCategory[], combos: [] as SellableCombo[] };
  }

  const [menus, products, combos, availabilityRows, taxProfile] = await Promise.all([
    db.menu.findMany({ where: { brandId: location.brandId, isActive: true }, select: { id: true, isDefault: true, schedules: true, products: { select: { productId: true } }, combos: { select: { comboId: true } } } }),
    db.product.findMany({
      where: { brandId: location.brandId, isActive: true, category: { isActive: true, deletedAt: null } },
      select: {
        id: true, name: true, description: true, imageUrl: true, tags: true, allergens: true, stationKey: true, taxCategoryId: true, sortOrder: true,
        category: { select: { id: true, name: true, imageUrl: true, sortOrder: true } },
        variants: { where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }], select: { id: true, name: true, isDefault: true } },
        modifiers: { orderBy: { sortOrder: "asc" }, select: { minSelectOverride: true, maxSelectOverride: true, modifierGroup: { select: { id: true, name: true, minSelect: true, maxSelect: true, isActive: true, deletedAt: true, options: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, isDefault: true } } } } } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.combo.findMany({
      where: { brandId: location.brandId, isActive: true },
      select: { id: true, name: true, description: true, imageUrl: true, taxCategoryId: true, startsAt: true, endsAt: true, slots: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, quantity: true, options: { select: { id: true, isDefault: true, variant: { select: { id: true, name: true, product: { select: { name: true, stationKey: true, taxCategoryId: true } } } } } } } } },
    }),
    db.locationAvailability.findMany({ where: { locationId: location.id } }),
    location.taxProfileId ? db.taxProfile.findFirst({ where: { id: location.taxProfileId }, include: { rules: { orderBy: { sortOrder: "asc" } } } }) : Promise.resolve(null),
  ]);

  // which products / combos are on a menu being served right now (a brand with no menus sells everything)
  const served = menus.filter((m) => (m.schedules.length ? isScheduled(m.schedules, now, location.timezone) : m.isDefault));
  const useMenus = menus.length > 0;
  const productOnMenu = new Set(served.flatMap((m) => m.products.map((p) => p.productId)));
  const comboOnMenu = new Set(served.flatMap((m) => m.combos.map((c) => c.comboId)));

  // every price that could apply: this branch's own, or its price book's
  const optionIds = products.flatMap((p) => p.modifiers.flatMap((m) => m.modifierGroup.options.map((o) => o.id)));
  const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
  const slotOptionIds = combos.flatMap((c) => c.slots.flatMap((s) => s.options.map((o) => o.id)));
  const priceRows = await db.price.findMany({
    where: {
      OR: [{ variantId: { in: variantIds } }, { modifierOptionId: { in: optionIds } }, { comboId: { in: combos.map((c) => c.id) } }, { comboSlotOptionId: { in: slotOptionIds } }],
      AND: [{ OR: [{ locationId: location.id }, { priceBookId: location.priceBookId }] }],
    },
  });
  const pricesByTarget = new Map<string, PriceRow[]>();
  for (const p of priceRows) {
    const targetId = (p.variantId ?? p.modifierOptionId ?? p.comboId ?? p.comboSlotOptionId)!;
    const row: PriceRow = { targetId, scope: p.locationId ? "LOCATION" : "BOOK", channel: p.channel as PriceChannel | null, amountMinor: p.amountMinor, compareAtMinor: p.compareAtMinor };
    pricesByTarget.set(targetId, [...(pricesByTarget.get(targetId) ?? []), row]);
  }
  const priceOf = (targetId: string) => resolvePrice(pricesByTarget.get(targetId) ?? [], channel);

  const state = new Map(availabilityRows.map((r) => [r.productId ?? r.comboId ?? r.modifierOptionId!, r]));
  const sellable = (id: string) => isSellableNow(state.get(id) ?? null, now);

  const categoryMap = new Map<string, { id: string; name: string; imageUrl: string | null; sortOrder: number; products: unknown[] }>();
  for (const p of products) {
    if (useMenus && !productOnMenu.has(p.id)) continue;
    if (!sellable(p.id)) continue;
    const variants = p.variants.flatMap((v) => {
      const price = priceOf(v.id);
      return price ? [{ id: v.id, name: v.name, isDefault: v.isDefault, priceMinor: price.amountMinor, compareAtMinor: price.compareAtMinor }] : [];
    });
    if (variants.length === 0) continue; // no price here and now: not sold at this branch
    const modifierGroups = p.modifiers
      .filter((m) => m.modifierGroup.isActive && !m.modifierGroup.deletedAt)
      .map((m) => ({
        id: m.modifierGroup.id, name: m.modifierGroup.name,
        minSelect: m.minSelectOverride ?? m.modifierGroup.minSelect, maxSelect: m.maxSelectOverride ?? m.modifierGroup.maxSelect,
        options: m.modifierGroup.options.filter((o) => sellable(o.id)).map((o) => ({ id: o.id, name: o.name, isDefault: o.isDefault, priceMinor: priceOf(o.id)?.amountMinor ?? 0 })),
      }));
    const cat = categoryMap.get(p.category.id) ?? { ...p.category, products: [] };
    cat.products.push({ id: p.id, name: p.name, description: p.description, imageUrl: p.imageUrl, tags: p.tags, allergens: p.allergens, stationKey: p.stationKey, taxCategoryId: p.taxCategoryId, variants, modifierGroups });
    categoryMap.set(p.category.id, cat);
  }

  const comboRows = combos.flatMap((c) => {
    if (useMenus && !comboOnMenu.has(c.id)) return [];
    if (!sellable(c.id)) return [];
    if ((c.startsAt && c.startsAt > now) || (c.endsAt && c.endsAt <= now)) return [];
    const price = priceOf(c.id);
    if (!price) return [];
    return [{
      id: c.id, name: c.name, description: c.description, imageUrl: c.imageUrl, taxCategoryId: c.taxCategoryId, priceMinor: price.amountMinor, compareAtMinor: price.compareAtMinor,
      slots: c.slots.map((s) => ({ id: s.id, name: s.name, quantity: s.quantity, options: s.options.map((o) => ({ id: o.id, variantId: o.variant.id, productName: o.variant.product.name, variantName: o.variant.name, stationKey: o.variant.product.stationKey, taxCategoryId: o.variant.product.taxCategoryId, name: `${o.variant.product.name} (${o.variant.name})`, isDefault: o.isDefault, upchargeMinor: priceOf(o.id)?.amountMinor ?? 0 })) })),
    }];
  });

  return {
    location: { id: location.id, name: location.name, timezone: location.timezone },
    currencyCode: location.currencyCode,
    channel, at: now.toISOString(),
    // the branch's tax rules, so the POS can show the same totals the server will compute
    tax: taxProfile
      ? {
          pricesIncludeTax: taxProfile.pricesIncludeTax,
          rules: taxProfile.rules.map((r) => ({ ruleId: r.id, name: r.name, authorityCode: r.authorityCode, rateBp: toBasisPoints(r.ratePercent.toString()), taxCategoryId: r.taxCategoryId, orderTypes: r.orderTypes as string[], validFrom: r.validFrom?.toISOString() ?? null, validTo: r.validTo?.toISOString() ?? null })),
        }
      : null,
    categories: [...categoryMap.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)) as SellableCategory[],
    combos: comboRows as SellableCombo[],
  };
}

catalog.get("/sellable", "menu.view", async (req, res) => {
  res.json({ data: await buildSellableMenu(sellableQuerySchema.parse(req.query)) });
});

export const catalogRouter = catalog.router;
