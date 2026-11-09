import { z } from "zod";
import { themeSchema } from "../theme.js";
import { LOCATION_TYPES, ORDER_TYPES, PAYMENT_METHOD_TYPES } from "../enums.js";
import {
  countryCodeSchema,
  currencyCodeSchema,
  hexColorSchema,
  httpUrlSchema,
  idSchema,
  slugSchema,
  timeOfDaySchema,
  timezoneSchema,
} from "./common.js";

// ---- tenant ----
export const tenantSettingsSchema = z.object({
  // Food-cost variance traffic lights (percent): green below amber, red above red.
  varianceAmberPercent: z.number().min(0).max(100).default(2),
  varianceRedPercent: z.number().min(0).max(100).default(5),
  // POS never blocks a sale for lack of stock; negative stock raises an alert instead.
  allowNegativeStock: z.boolean().default(true),
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export const tenantUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  defaultLocale: z.string().trim().min(2).max(10).optional(),
  settings: tenantSettingsSchema.partial().optional(),
  /** Replaces the whole theme; send {} to reset to the default look. */
  theme: themeSchema.optional(),
});

// ---- brands ----
export const brandInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: slugSchema,
  logoUrl: httpUrlSchema.nullable().optional(),
  primaryColor: hexColorSchema.nullable().optional(),
  cuisine: z.string().trim().max(60).nullable().optional(),
  isActive: z.boolean().optional(),
});
export const brandUpdateSchema = brandInputSchema.partial();

// ---- price books (minimal in Phase 1; extended with prices in the catalog phase) ----
export const priceBookInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  currencyCode: currencyCodeSchema,
  brandId: idSchema.nullable().optional(),
  isDefault: z.boolean().optional(),
});
export const priceBookUpdateSchema = priceBookInputSchema.partial();

// ---- locations (branches, warehouses, central kitchens) ----
export const locationInputSchema = z.object({
  type: z.enum(LOCATION_TYPES),
  brandId: idSchema.nullable().optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,20}$/, "Use letters, numbers and dashes (max 20)"),
  name: z.string().trim().min(1).max(120),
  countryCode: countryCodeSchema,
  city: z.string().trim().max(80).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  timezone: timezoneSchema,
  currencyCode: currencyCodeSchema,
  taxProfileId: idSchema.nullable().optional(),
  priceBookId: idSchema.nullable().optional(),
  businessDayStartTime: timeOfDaySchema.default("05:00"),
  receiptHeader: z.string().trim().max(500).nullable().optional(),
  receiptFooter: z.string().trim().max(500).nullable().optional(),
  orderPrefix: z.string().trim().toUpperCase().max(4).nullable().optional(),
  acceptsOnlineOrders: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export const locationUpdateSchema = locationInputSchema.partial();

export const openingHoursInputSchema = z.object({
  hours: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6), // 0 = Sunday
        opensAt: timeOfDaySchema,
        closesAt: timeOfDaySchema, // earlier than opensAt = closes after midnight
      }),
    )
    .max(28),
});

export const locationPaymentMethodsInputSchema = z.object({
  methods: z.array(z.object({ paymentMethodId: idSchema, isEnabled: z.boolean(), sortOrder: z.number().int().min(0).max(999).default(0) })).max(50),
});

// ---- tables and stations (per branch) ----
export const diningTableInputSchema = z.object({
  locationId: idSchema,
  name: z.string().trim().min(1).max(40),
  seats: z.number().int().min(1).max(100).default(4),
  section: z.string().trim().max(40).nullable().optional(),
  isActive: z.boolean().optional(),
});
export const diningTableUpdateSchema = diningTableInputSchema.partial().omit({ locationId: true });

export const kitchenStationInputSchema = z.object({
  locationId: idSchema,
  key: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, "Use letters, numbers and underscores"),
  name: z.string().trim().min(1).max(60),
  sortOrder: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().optional(),
});
export const kitchenStationUpdateSchema = kitchenStationInputSchema.partial().omit({ locationId: true });

// ---- taxes ----
export const taxCategoryInputSchema = z.object({ name: z.string().trim().min(1).max(60) });
export const taxCategoryUpdateSchema = taxCategoryInputSchema.partial();

export const taxRuleInputSchema = z.object({
  taxCategoryId: idSchema.nullable().optional(), // null = applies to every category
  name: z.string().trim().min(1).max(60),
  authorityCode: z.string().trim().toUpperCase().max(20), // SRB, PRA, FTA, TX ...
  ratePercent: z.number().min(0).max(100).multipleOf(0.0001),
  isCompound: z.boolean().default(false),
  orderTypes: z.array(z.enum(ORDER_TYPES)).default([]), // empty = all order types
  sortOrder: z.number().int().min(0).max(99).default(0),
});

export const taxProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  countryCode: countryCodeSchema,
  pricesIncludeTax: z.boolean(),
});
export const taxProfileUpdateSchema = taxProfileInputSchema.partial();
export const taxProfileRulesInputSchema = z.object({ rules: z.array(taxRuleInputSchema).max(20) });

// ---- payment methods ----
export const paymentMethodInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(PAYMENT_METHOD_TYPES),
  providerCode: z.string().trim().max(40).nullable().optional(),
  requiresReference: z.boolean().optional(),
  opensDrawer: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export const paymentMethodUpdateSchema = paymentMethodInputSchema.partial();
