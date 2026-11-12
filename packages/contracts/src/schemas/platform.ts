import { z } from "zod";
import { currencyCodeSchema, idSchema, slugSchema } from "./common.js";
import { passwordSchema } from "./iam.js";

// The Restoflux team's console: managing the organizations (tenants) that use the product.

export const ORGANIZATION_STATUSES = ["TRIAL", "ACTIVE", "SUSPENDED"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const PLANS = ["starter", "standard", "growth", "enterprise"] as const;

const limitSchema = z.number().int().min(1).max(100_000).nullable();

export const organizationCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  currency: currencyCodeSchema.default("PKR"),
  status: z.enum(["TRIAL", "ACTIVE"]).default("TRIAL"),
  plan: z.enum(PLANS).default("standard"),
  trialDays: z.number().int().min(1).max(365).default(14),
  maxLocations: limitSchema.optional(),
  maxUsers: limitSchema.optional(),
  ownerName: z.string().trim().min(1).max(100),
  ownerEmail: z.email().transform((e) => e.toLowerCase()),
  /** Leave out to have one generated (returned once in the response). */
  ownerPassword: z.string().min(12, "Use at least 12 characters").max(72).optional(),
});
export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>;

export const organizationUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  plan: z.enum(PLANS).optional(),
  maxLocations: limitSchema.optional(),
  maxUsers: limitSchema.optional(),
  trialEndsAt: z.iso.datetime().nullable().optional(),
});

export const organizationStatusSchema = z.object({
  status: z.enum(ORGANIZATION_STATUSES),
  /** Shown in the audit log; required when suspending. */
  reason: z.string().trim().max(300).optional(),
});

export const organizationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  status: z.enum(ORGANIZATION_STATUSES).optional(),
  sort: z.string().trim().max(60).optional(),
});

export const platformUserCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().transform((e) => e.toLowerCase()),
  password: passwordSchema,
});

/** Change a team member: name, email, a new password, or their status. Anything left out stays as it is. */
export const platformUserUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.email().transform((e) => e.toLowerCase()).optional(),
  password: passwordSchema.optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to change" });

export interface PlatformMe {
  id: string;
  name: string;
  email: string;
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  plan: string;
  baseCurrency: string;
  trialEndsAt: string | null;
  maxLocations: number | null;
  maxUsers: number | null;
  suspendedReason: string | null;
  createdAt: string;
  counts: { brands: number; locations: number; users: number };
  lastActivityAt: string | null;
}

export const orgIdParam = idSchema;
