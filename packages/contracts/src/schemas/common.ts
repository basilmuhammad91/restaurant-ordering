import { z } from "zod";

// Building blocks reused by every module's schemas. (Laravel: shared validation rules / rule objects.)

export const idSchema = z.uuid();

export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single dashes");

export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code, e.g. PKR");
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, "Use a 2-letter ISO country code, e.g. PK");

export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24 hour)");

export const timezoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown timezone (use an IANA name such as Asia/Karachi)");

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #a3141c");

export const httpUrlSchema = z.url({ protocol: /^https?$/ }).max(500);

/** Money limits in minor units must fit a Postgres INT. */
export const minorAmountSchema = z.number().int().min(0).max(2_000_000_000);

/** `?locationIds=a,b,c` */
export const csvIdsSchema = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(idSchema));

/** Offset pagination + search + sort, shared by every admin table endpoint. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  sort: z.string().trim().max(100).optional(), // e.g. "-createdAt,name"
  includeArchived: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

/** Cursor pagination for large append-only lists (audit log, notifications). */
export const cursorQuerySchema = z.object({
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;
