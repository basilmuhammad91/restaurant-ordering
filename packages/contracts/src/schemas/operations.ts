import { z } from "zod";
import { idSchema, minorAmountSchema } from "./common.js";

// Delivery, staff and settings.

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30");
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const deliveryZoneInputSchema = z.object({
  locationId: idSchema,
  name: z.string().trim().min(1).max(100),
  feeMinor: minorAmountSchema.optional(),
  minOrderMinor: minorAmountSchema.optional(),
  estimatedMinutes: z.number().int().min(1).max(600).optional(),
  isActive: z.boolean().optional(),
});
export const deliveryZoneUpdateSchema = deliveryZoneInputSchema.partial();

export const riderInputSchema = z.object({ name: z.string().trim().min(1).max(100), phone: optionalText(30), vehicle: optionalText(60), isActive: z.boolean().optional() });
export const riderUpdateSchema = riderInputSchema.partial();

export const assignRiderSchema = z.object({ riderId: idSchema });
export const deliveryFailSchema = z.object({ reason: z.string().trim().min(1, "Say what went wrong").max(200) });

export const employeeInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  locationId: idSchema.nullable().optional(),
  userId: idSchema.nullable().optional(),
  phone: optionalText(30),
  email: z.union([z.literal(""), z.string().trim().email().max(150)]).nullable().optional(),
  position: optionalText(60),
  hourlyRateMinor: minorAmountSchema.nullable().optional(),
  startDate: dateOnly.nullable().optional(),
  notes: optionalText(500),
  isActive: z.boolean().optional(),
});
export const employeeUpdateSchema = employeeInputSchema.partial();

export const rosterShiftInputSchema = z.object({
  employeeId: idSchema,
  locationId: idSchema,
  shiftDate: dateOnly,
  startTime: timeOfDay,
  endTime: timeOfDay,
  position: optionalText(60),
  note: optionalText(200),
}).refine((v) => v.startTime !== v.endTime, { path: ["endTime"], message: "A shift cannot start and end at the same time" });
export const rosterCopySchema = z.object({ locationId: idSchema, fromWeekStart: dateOnly, toWeekStart: dateOnly });

export const clockInSchema = z.object({ employeeId: idSchema, locationId: idSchema, note: optionalText(200) });
export const clockOutSchema = z.object({ employeeId: idSchema, breakMinutes: z.number().int().min(0).max(600).optional() });
export const timeEntryAdjustSchema = z.object({
  clockInAt: z.iso.datetime().optional(),
  clockOutAt: z.iso.datetime().nullable().optional(),
  breakMinutes: z.number().int().min(0).max(600).optional(),
  reason: z.string().trim().min(1, "Say why the times are being changed").max(200),
});

export const receiptTemplateSchema = z.object({
  headerText: optionalText(300),
  footerText: optionalText(300),
  showTaxBreakdown: z.boolean(),
  showCustomer: z.boolean(),
  showCashier: z.boolean(),
});

/** What can notify a person, and why. A person chooses which of these appear in their own bell. */
export const NOTIFICATION_TYPES = [
  { type: "APPROVAL_PENDING", label: "Approval needed", help: "A cashier needs your OK for a large discount, void or refund." },
  { type: "APPROVAL_DECIDED", label: "Approval decided", help: "Your own request was approved or rejected." },
  { type: "CASH_SHORTAGE", label: "Cash short at close", help: "A till closed with less cash than expected." },
  { type: "CASH_OVERAGE", label: "Cash over at close", help: "A till closed with more cash than expected." },
  { type: "LOW_STOCK", label: "Low stock", help: "An item fell to or below its reorder level." },
] as const;
export const notificationPreferencesSchema = z.object({ preferences: z.array(z.object({ type: z.string().min(1).max(60), inApp: z.boolean() })).max(50) });
