import { z } from "zod";
import { ALLERGENS, PRICE_CHANNELS, PRODUCT_TAGS } from "../catalog.js";
import { httpUrlSchema, idSchema, minorAmountSchema, timeOfDaySchema } from "./common.js";

// Validation for the catalog endpoints. Nested things (variants, options, slots, schedules) are sent
// together with their parent and saved in one transaction, so a product can never exist half-built.

const name = z.string().trim().min(1).max(100);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const sortOrder = z.number().int().min(0).max(100_000).optional();

// ---- categories ----
export const categoryInputSchema = z.object({
  brandId: idSchema,
  name,
  imageUrl: httpUrlSchema.nullable().optional(),
  sortOrder,
  isActive: z.boolean().optional(),
});
export const categoryUpdateSchema = categoryInputSchema.partial();

// ---- products ----
export const variantInputSchema = z.object({
  id: idSchema.optional(),
  name,
  sku: optionalText(40),
  isDefault: z.boolean().optional(),
  sortOrder,
});

export const productModifierLinkSchema = z.object({
  modifierGroupId: idSchema,
  sortOrder,
  minSelectOverride: z.number().int().min(0).max(50).nullable().optional(),
  maxSelectOverride: z.number().int().min(1).max(50).nullable().optional(),
});

const productFields = {
  brandId: idSchema,
  categoryId: idSchema,
  name,
  description: optionalText(1000),
  imageUrl: httpUrlSchema.nullable().optional(),
  sku: optionalText(40),
  taxCategoryId: idSchema.nullable().optional(),
  stationKey: z.string().trim().toUpperCase().max(30).nullable().optional(),
  tags: z.array(z.enum(PRODUCT_TAGS)).max(PRODUCT_TAGS.length).optional(),
  allergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length).optional(),
  isActive: z.boolean().optional(),
  sortOrder,
  variants: z.array(variantInputSchema).min(1, "A product needs at least one size or variant").max(20),
  modifierGroups: z.array(productModifierLinkSchema).max(20).optional(),
};
const oneDefault = (v: { variants?: { isDefault?: boolean | undefined }[] | undefined }) => (v.variants ?? []).filter((x) => x.isDefault).length <= 1;
export const productInputSchema = z.object(productFields).refine(oneDefault, { message: "Only one variant can be the default", path: ["variants"] });
export const productUpdateSchema = z.object(productFields).partial().refine(oneDefault, { message: "Only one variant can be the default", path: ["variants"] });

// ---- modifiers ----
export const modifierOptionInputSchema = z.object({ id: idSchema.optional(), name, isDefault: z.boolean().optional(), sortOrder });
const groupFields = {
  brandId: idSchema,
  name,
  minSelect: z.number().int().min(0).max(50).default(0),
  maxSelect: z.number().int().min(1).max(50).default(1),
  isActive: z.boolean().optional(),
  options: z.array(modifierOptionInputSchema).min(1, "Add at least one option").max(100),
};
const groupRules = (v: { minSelect?: number | undefined; maxSelect?: number | undefined; options?: unknown[] | undefined }) =>
  (v.minSelect ?? 0) <= (v.maxSelect ?? 1) && (v.options === undefined || (v.minSelect ?? 0) <= v.options.length);
export const modifierGroupInputSchema = z.object(groupFields).refine(groupRules, { message: "Minimum cannot exceed the maximum or the number of options", path: ["minSelect"] });
export const modifierGroupUpdateSchema = z.object(groupFields).partial().refine(groupRules, { message: "Minimum cannot exceed the maximum or the number of options", path: ["minSelect"] });

// ---- combos ----
export const comboSlotInputSchema = z.object({
  id: idSchema.optional(),
  name,
  quantity: z.number().int().min(1).max(20).default(1),
  options: z.array(z.object({ id: idSchema.optional(), variantId: idSchema, isDefault: z.boolean().optional() })).min(1, "Each slot needs at least one choice").max(50),
});
const comboFields = {
  brandId: idSchema,
  name,
  description: optionalText(1000),
  imageUrl: httpUrlSchema.nullable().optional(),
  taxCategoryId: idSchema.nullable().optional(),
  isActive: z.boolean().optional(),
  startsAt: z.iso.datetime().nullable().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
  slots: z.array(comboSlotInputSchema).min(1, "A combo needs at least one slot").max(12),
};
const comboWindow = (v: { startsAt?: string | null | undefined; endsAt?: string | null | undefined }) => !v.startsAt || !v.endsAt || v.startsAt < v.endsAt;
export const comboInputSchema = z.object(comboFields).refine(comboWindow, { message: "The end must be after the start", path: ["endsAt"] });
export const comboUpdateSchema = z.object(comboFields).partial().refine(comboWindow, { message: "The end must be after the start", path: ["endsAt"] });

// ---- menus ----
export const menuScheduleInputSchema = z
  .object({
    weekdays: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day").max(7),
    startsAt: timeOfDaySchema.nullable().optional(),
    endsAt: timeOfDaySchema.nullable().optional(),
  })
  .refine((s) => (s.startsAt == null) === (s.endsAt == null), { message: "Set both times, or leave both empty for all day", path: ["startsAt"] })
  .refine((s) => s.startsAt == null || s.startsAt !== s.endsAt, { message: "Start and end cannot be the same time", path: ["endsAt"] });
const menuFields = {
  brandId: idSchema,
  name,
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  schedules: z.array(menuScheduleInputSchema).max(14),
  productIds: z.array(idSchema).max(1000),
  comboIds: z.array(idSchema).max(200),
};
export const menuInputSchema = z.object({ ...menuFields, schedules: menuFields.schedules.default([]), productIds: menuFields.productIds.default([]), comboIds: menuFields.comboIds.default([]) });
export const menuUpdateSchema = z.object(menuFields).partial();

// ---- prices ----
const priceTarget = z.union([
  z.object({ variantId: idSchema }).strict(),
  z.object({ modifierOptionId: idSchema }).strict(),
  z.object({ comboId: idSchema }).strict(),
  z.object({ comboSlotOptionId: idSchema }).strict(),
]);
const priceScope = z.union([z.object({ priceBookId: idSchema }).strict(), z.object({ locationId: idSchema }).strict()]);

export const priceInputSchema = z.object({
  target: priceTarget,
  scope: priceScope,
  channel: z.enum(PRICE_CHANNELS).nullable().optional(),
  amountMinor: minorAmountSchema,
  compareAtMinor: minorAmountSchema.min(1).nullable().optional(),
});
export const pricesUpsertSchema = z.object({ prices: z.array(priceInputSchema).min(1).max(500) });
export const pricesDeleteSchema = z.object({ ids: z.array(idSchema).min(1).max(500) });

export const priceListQuerySchema = z
  .object({ variantId: idSchema.optional(), modifierOptionId: idSchema.optional(), comboId: idSchema.optional(), comboSlotOptionId: idSchema.optional(), priceBookId: idSchema.optional(), locationId: idSchema.optional() })
  .refine((q) => !!(q.variantId || q.modifierOptionId || q.comboId || q.comboSlotOptionId), { message: "Say which item to list prices for" });

// ---- availability (the "86" board) ----
export const availabilityUpdateSchema = z.object({
  target: z.union([z.object({ productId: idSchema }).strict(), z.object({ comboId: idSchema }).strict(), z.object({ modifierOptionId: idSchema }).strict()]),
  locationId: idSchema,
  isListed: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  /** When the sold-out flag lapses by itself. Omit for "until someone turns it back on". */
  soldOutUntil: z.iso.datetime().nullable().optional(),
});

export const sellableQuerySchema = z.object({
  locationId: idSchema,
  channel: z.enum(PRICE_CHANNELS).optional(),
  /** Pretend it is this moment (for previewing the lunch menu at 9am). */
  at: z.iso.datetime().optional(),
});

export type ProductInput = z.infer<typeof productInputSchema>;
export type ModifierGroupInput = z.infer<typeof modifierGroupInputSchema>;
export type ComboInput = z.infer<typeof comboInputSchema>;
export type MenuInput = z.infer<typeof menuInputSchema>;
export type PriceInput = z.infer<typeof priceInputSchema>;
