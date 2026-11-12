import { z } from "zod";
import { idSchema } from "./common.js";

// Validation for inventory: items, recipes, adjustments, counts, transfers and production.
// Quantities are in the item's own unit and may have up to 3 decimals; costs are minor units per unit.

export const INVENTORY_UNITS = ["kg", "g", "l", "ml", "pcs"] as const;
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];
export const INVENTORY_KINDS = ["RAW", "PREP", "PACKAGING"] as const;

const name = z.string().trim().min(1).max(100);
const qty = z.number().min(0).max(1_000_000_000);
const positiveQty = z.number().positive().max(1_000_000_000);
const cost = z.number().min(0).max(1_000_000_000);

export const inventoryItemInputSchema = z.object({
  name,
  sku: z.string().trim().max(40).nullable().optional(),
  kind: z.enum(INVENTORY_KINDS).optional(),
  unit: z.enum(INVENTORY_UNITS),
  category: z.string().trim().max(60).nullable().optional(),
  referenceCost: cost.optional(),
  reorderLevel: qty.nullable().optional(),
  parLevel: qty.nullable().optional(),
  isActive: z.boolean().optional(),
});
export const inventoryItemUpdateSchema = inventoryItemInputSchema.partial();

// ---- recipes ----
export const recipeLineInputSchema = z.object({
  itemId: idSchema,
  qty: z.number().positive().max(1_000_000),
  wastePercent: z.number().min(0).max(90).optional(),
});
export const recipeInputSchema = z
  .object({
    variantId: idSchema.optional(),
    prepItemId: idSchema.optional(),
    yieldQty: positiveQty.optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    lines: z.array(recipeLineInputSchema).min(1, "Add at least one ingredient").max(60),
  })
  .refine((v) => Boolean(v.variantId) !== Boolean(v.prepItemId), { message: "A recipe is for a menu item or a prep item, not both" });

// ---- adjustments and waste ----
export const ADJUSTMENT_TYPES = ["ADJUSTMENT", "WASTE", "EXPIRED", "DAMAGE", "STAFF_MEAL", "OPENING"] as const;
export const adjustmentInputSchema = z
  .object({
    locationId: idSchema,
    itemId: idSchema,
    type: z.enum(ADJUSTMENT_TYPES),
    /** WASTE, EXPIRED, DAMAGE and STAFF_MEAL always take stock out and OPENING always adds. ADJUSTMENT uses the sign given. */
    qty: z.number().max(1_000_000_000).refine((n) => n !== 0, "Quantity cannot be zero"),
    reason: z.string().trim().max(200).nullable().optional(),
    unitCost: cost.optional(),
  })
  .refine((v) => v.type !== "ADJUSTMENT" || Boolean(v.reason?.trim()), { path: ["reason"], message: "Say why the stock is being adjusted" });

// ---- counts ----
export const countCreateSchema = z.object({
  locationId: idSchema,
  note: z.string().trim().max(500).nullable().optional(),
  /** Leave out to count every active item. */
  itemIds: z.array(idSchema).max(2000).optional(),
});
export const countLinesSchema = z.object({
  lines: z.array(z.object({ itemId: idSchema, countedQty: qty.nullable() })).min(1).max(2000),
});

// ---- transfers ----
export const transferCreateSchema = z
  .object({
    fromLocationId: idSchema,
    toLocationId: idSchema,
    note: z.string().trim().max(500).nullable().optional(),
    lines: z.array(z.object({ itemId: idSchema, qty: positiveQty })).min(1, "Add at least one item").max(200),
  })
  .refine((v) => v.fromLocationId !== v.toLocationId, { path: ["toLocationId"], message: "Choose a different location to send to" });
export const transferReceiveSchema = z.object({
  lines: z.array(z.object({ itemId: idSchema, receivedQty: qty })).min(1).max(200),
});

// ---- production ----
export const productionInputSchema = z.object({
  locationId: idSchema,
  prepItemId: idSchema,
  producedQty: positiveQty,
  note: z.string().trim().max(500).nullable().optional(),
});

export const movementQuerySchema = z.object({
  locationId: idSchema,
  itemId: idSchema.optional(),
  types: z.string().max(200).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
