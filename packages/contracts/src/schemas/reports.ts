import { z } from "zod";
import { idSchema } from "./common.js";

// Query for the reports that look at a period, across the brand and branches chosen in the top bar.
export const reportQuerySchema = z.object({
  locationIds: z.string().transform((s) => s.split(",").filter(Boolean)).pipe(z.array(idSchema).max(200)).optional(),
  brandId: idSchema.optional(),
  from: z.iso.date(),
  to: z.iso.date(),
  /** Reports never mix currencies. Defaults to the organization's own currency. */
  currencyCode: z.string().length(3).toUpperCase().optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const supplierLedgerQuerySchema = z.object({ supplierId: idSchema, from: z.iso.date(), to: z.iso.date() });
