import { z } from "zod";
import { idSchema, minorAmountSchema } from "./common.js";

// Customers, loyalty, coupons, promotions and feedback.

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30");
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const customerInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: optionalText(30),
  email: z.union([z.literal(""), z.string().trim().email().max(150)]).nullable().optional(),
  notes: optionalText(500),
  birthday: dateOnly.nullable().optional(),
  marketingOptIn: z.boolean().optional(),
});
export const customerUpdateSchema = customerInputSchema.partial();

export const loyaltyProgramSchema = z.object({
  isEnabled: z.boolean(),
  earnPerPointMinor: z.number().int().min(1).max(2_000_000_000),
  redeemValueMinor: z.number().int().min(1).max(2_000_000_000),
  minRedeemPoints: z.number().int().min(1).max(1_000_000),
});
export const loyaltyAdjustSchema = z.object({ points: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, "Points cannot be zero"), note: z.string().trim().min(1, "Say why").max(200) });
export const loyaltyRedeemSchema = z.object({ points: z.number().int().min(1).max(1_000_000) });

/** PERCENT is a percentage such as 12.5; AMOUNT is minor units. The API stores percent in basis points. */
const offerFields = {
  valueType: z.enum(["PERCENT", "AMOUNT"]),
  value: z.number().positive().max(2_000_000_000),
  minSubtotalMinor: minorAmountSchema.optional(),
  validFrom: dateOnly.nullable().optional(),
  validTo: dateOnly.nullable().optional(),
  isActive: z.boolean().optional(),
};
const percentOk = (v: { valueType?: string; value?: number }) => v.valueType !== "PERCENT" || v.value === undefined || v.value <= 100;

export const couponInputSchema = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only"),
  description: optionalText(200),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  ...offerFields,
}).refine(percentOk, { path: ["value"], message: "A percentage cannot be more than 100" });
export const couponUpdateSchema = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/).optional(),
  description: optionalText(200),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  ...Object.fromEntries(Object.entries(offerFields).map(([k, v]) => [k, (v as z.ZodType).optional()])),
}).partial();
export const couponCheckSchema = z.object({ code: z.string().trim().min(1).max(40), locationId: idSchema, subtotalMinor: minorAmountSchema.optional() });

export const promotionInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: optionalText(300),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  startTime: timeOfDay.nullable().optional(),
  endTime: timeOfDay.nullable().optional(),
  locationIds: z.array(idSchema).max(200).optional(),
  ...offerFields,
}).refine(percentOk, { path: ["value"], message: "A percentage cannot be more than 100" })
  .refine((v) => Boolean(v.startTime) === Boolean(v.endTime), { path: ["endTime"], message: "Set both a start and an end time, or neither" });
export const promotionUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: optionalText(300),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  startTime: timeOfDay.nullable().optional(),
  endTime: timeOfDay.nullable().optional(),
  locationIds: z.array(idSchema).max(200).optional(),
  ...Object.fromEntries(Object.entries(offerFields).map(([k, v]) => [k, (v as z.ZodType).optional()])),
}).partial();

export const feedbackInputSchema = z.object({
  locationId: idSchema,
  rating: z.number().int().min(1).max(5),
  comment: optionalText(1000),
  orderId: idSchema.nullable().optional(),
  customerId: idSchema.nullable().optional(),
  source: z.enum(["STAFF", "TABLE", "ONLINE", "PHONE"]).optional(),
});
export const feedbackReplySchema = z.object({ reply: z.string().trim().min(1).max(1000) });
