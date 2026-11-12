import { z } from "zod";
import { PRICE_CHANNELS } from "../catalog.js";
import { ORDER_TYPES } from "../enums.js";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "../orders.js";
import { cursorQuerySchema, idSchema, minorAmountSchema } from "./common.js";

// Validation for orders, payments, shifts and cash. The client sends WHAT was ordered (ids and quantities)
// and never prices, taxes or totals: the server works those out from the menu and the branch's tax rules.

const text = (max: number) => z.string().trim().max(max).nullable().optional();

// ---- order lines ----
export const itemLineInputSchema = z.object({
  kind: z.literal("item"),
  variantId: idSchema,
  quantity: z.number().int().min(1).max(100),
  modifierOptionIds: z.array(idSchema).max(30).default([]),
  notes: text(200),
});
export const comboLineInputSchema = z.object({
  kind: z.literal("combo"),
  comboId: idSchema,
  quantity: z.number().int().min(1).max(100),
  /** One entry per unit of each slot. A slot with a single choice may be left out. */
  choices: z.array(z.object({ slotId: idSchema, optionId: idSchema })).max(60).default([]),
  notes: text(200),
});
export const orderLineInputSchema = z.discriminatedUnion("kind", [itemLineInputSchema, comboLineInputSchema]);
export type OrderLineInputBody = z.infer<typeof orderLineInputSchema>;

export const orderDiscountInputSchema = z.object({
  type: z.enum(["PERCENT", "AMOUNT"]),
  /** PERCENT: a percentage such as 12.5. AMOUNT: minor units. */
  value: z.number().min(0).max(2_000_000_000),
  reasonId: idSchema,
  note: text(200),
  /** Approval id when a manager approved a discount above the cashier's own limit (retry with it). */
  approvalId: idSchema.nullable().optional(),
});

export const deliveryAddressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  area: text(100),
  city: text(100),
  instructions: text(300),
});

const orderFields = {
  locationId: idSchema,
  orderType: z.enum(ORDER_TYPES),
  channel: z.enum(PRICE_CHANNELS).default("POS"),
  /** OPEN = a held bill (not sent to the kitchen yet). Default: POS/PHONE go straight to the kitchen, other channels wait for acceptance. */
  status: z.enum(["OPEN", "PENDING", "CONFIRMED"]).optional(),
  lines: z.array(orderLineInputSchema).min(1, "Add at least one item").max(100),
  customerName: text(100),
  customerPhone: text(30),
  tableId: idSchema.nullable().optional(),
  covers: z.number().int().min(1).max(100).nullable().optional(),
  notes: text(500),
  deliveryAddress: deliveryAddressSchema.nullable().optional(),
  deliveryFeeMinor: minorAmountSchema.optional(),
  aggregatorName: text(60),
  aggregatorRef: text(60),
  discount: orderDiscountInputSchema.nullable().optional(),
  /** A coupon code or a running promotion. The server looks it up and decides the amount; the till never sends one. */
  offer: z.object({ couponCode: z.string().trim().min(1).max(40).optional(), promotionId: idSchema.optional() }).refine((o) => Boolean(o.couponCode) !== Boolean(o.promotionId), "Send a coupon code or a promotion, not both").nullable().optional(),
  /** When the sale really happened (an offline POS syncing later). Defaults to now. */
  occurredAt: z.iso.datetime().optional(),
};
export const orderCreateSchema = z.object({ /** A UUID made by the client: sending the same order twice returns the first. */ id: idSchema.optional(), ...orderFields });
export const orderReplaceSchema = z.object(orderFields);
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

// ---- lifecycle ----
export const orderStatusInputSchema = z.object({ status: z.enum(ORDER_STATUSES), reasonId: idSchema.optional(), note: text(300), approvalId: idSchema.nullable().optional() });

export const paymentInputSchema = z.object({
  /** Client-made UUID: a retried payment is recognised and not charged twice. */
  id: idSchema.optional(),
  paymentMethodId: idSchema,
  tenderedMinor: minorAmountSchema.min(1),
  tipMinor: minorAmountSchema.optional(),
  reference: text(80),
});

export const lineVoidInputSchema = z.object({ reasonId: idSchema, note: text(300), approvalId: idSchema.nullable().optional() });
export const refundInputSchema = z.object({
  amountMinor: minorAmountSchema.min(1),
  paymentMethodId: idSchema,
  reasonId: idSchema,
  note: text(300),
  approvalId: idSchema.nullable().optional(),
});

export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(60).optional(),
  sort: z.string().trim().max(60).optional(),
  locationId: idSchema.optional(),
  status: z.string().transform((s) => s.split(",").filter(Boolean)).pipe(z.array(z.enum(ORDER_STATUSES))).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  orderType: z.enum(ORDER_TYPES).optional(),
  channel: z.enum(PRICE_CHANNELS).optional(),
  /** Trading dates, "yyyy-MM-dd" */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Only orders still being worked on (not completed or cancelled). */
  active: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

// ---- kitchen display ----
export const kitchenQuerySchema = z.object({ locationId: idSchema, station: z.string().trim().toUpperCase().max(30).optional() });
export const lineStatusInputSchema = z.object({ status: z.enum(["PREPARING", "READY", "SERVED"]) });

// ---- shifts and cash ----
export const registerInputSchema = z.object({ locationId: idSchema, name: z.string().trim().min(1).max(60), isActive: z.boolean().optional() });
export const registerUpdateSchema = registerInputSchema.partial();

export const shiftOpenSchema = z.object({
  locationId: idSchema,
  /** Leave out to use the branch's till (one is created if the branch has none). */
  registerId: idSchema.optional(),
  openingFloatMinor: minorAmountSchema,
  /** Hide the expected cash from the person counting at close. */
  isBlindClose: z.boolean().optional(),
});
export const shiftCloseSchema = z.object({ countedCashMinor: minorAmountSchema, notes: text(300) });
export const cashMovementInputSchema = z.object({
  type: z.enum(["CASH_IN", "CASH_OUT", "PAID_OUT", "SAFE_DROP"]),
  amountMinor: minorAmountSchema.min(1),
  /** Required for CASH_OUT and PAID_OUT. */
  reasonId: idSchema.optional(),
  note: text(300),
});
export const shiftListQuerySchema = cursorQuerySchema.extend({ locationId: idSchema.optional(), status: z.enum(["OPEN", "CLOSED"]).optional() });

export const zReportDaySchema = z.object({ locationId: idSchema, businessDate: z.iso.date() });
export const zReportListQuerySchema = z.object({ locationId: idSchema.optional(), from: z.iso.date().optional(), to: z.iso.date().optional() });

export const salesSummaryQuerySchema = z.object({
  locationIds: z.string().transform((s) => s.split(",").filter(Boolean)).pipe(z.array(idSchema).max(200)).optional(),
  brandId: idSchema.optional(),
  from: z.iso.date(),
  to: z.iso.date(),
});

/** "KH-0042" */
export const formatOrderNumber = (prefix: string | null | undefined, n: number | null | undefined): string =>
  n == null ? "-" : `${prefix ? `${prefix}-` : ""}${String(n).padStart(4, "0")}`;
