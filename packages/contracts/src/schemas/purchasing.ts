import { z } from "zod";
import { idSchema, minorAmountSchema } from "./common.js";

// Validation for purchasing: suppliers, what they sell, purchase orders, receiving, invoices and payments.

const name = z.string().trim().min(1).max(120);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const packs = z.number().positive().max(1_000_000);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30");

export const supplierInputSchema = z.object({
  name,
  code: optionalText(30),
  contactName: optionalText(100),
  phone: optionalText(40),
  email: z.union([z.literal(""), z.string().trim().email().max(150)]).nullable().optional(),
  address: optionalText(300),
  taxId: optionalText(60),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  notes: optionalText(500),
  isActive: z.boolean().optional(),
});
export const supplierUpdateSchema = supplierInputSchema.partial();

export const supplierItemInputSchema = z.object({
  supplierId: idSchema,
  itemId: idSchema,
  supplierSku: optionalText(60),
  packName: z.string().trim().min(1).max(60).optional(),
  packQty: z.number().positive().max(1_000_000).optional(),
  priceMinor: minorAmountSchema,
  isPreferred: z.boolean().optional(),
  leadTimeDays: z.number().int().min(0).max(90).optional(),
  isActive: z.boolean().optional(),
});
export const supplierItemUpdateSchema = supplierItemInputSchema.partial();

export const poLineInputSchema = z.object({
  itemId: idSchema,
  packName: z.string().trim().min(1).max(60).optional(),
  packQty: z.number().positive().max(1_000_000).optional(),
  orderedPacks: packs,
  unitPriceMinor: minorAmountSchema,
});
export const purchaseOrderInputSchema = z.object({
  locationId: idSchema,
  supplierId: idSchema,
  expectedDate: dateOnly.nullable().optional(),
  note: optionalText(500),
  lines: z.array(poLineInputSchema).min(1, "Add at least one item").max(200),
});

export const receiveInputSchema = z.object({
  note: optionalText(500),
  lines: z.array(z.object({ itemId: idSchema, packs: z.number().min(0).max(1_000_000) })).min(1).max(200),
});
/** Goods that arrived without a purchase order. */
export const directReceiptSchema = z.object({
  locationId: idSchema,
  supplierId: idSchema,
  note: optionalText(500),
  lines: z.array(z.object({ itemId: idSchema, packName: z.string().trim().min(1).max(60).optional(), packQty: z.number().positive().max(1_000_000).optional(), packs, unitPriceMinor: minorAmountSchema })).min(1).max(200),
});

export const invoiceInputSchema = z.object({
  supplierId: idSchema,
  orderId: idSchema.nullable().optional(),
  invoiceNo: z.string().trim().min(1).max(60),
  invoiceDate: dateOnly,
  dueDate: dateOnly.optional(),
  totalMinor: z.number().int().min(1).max(2_000_000_000),
  note: optionalText(500),
});
export const supplierPaymentInputSchema = z.object({
  amountMinor: z.number().int().min(1).max(2_000_000_000),
  method: z.string().trim().min(1).max(40),
  reference: optionalText(80),
});
export const SUPPLIER_PAYMENT_METHODS = ["Cash", "Bank transfer", "Cheque", "Card", "Other"] as const;
