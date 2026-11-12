import { z } from "zod";
import { APPROVAL_TYPES, USER_STATUSES } from "../enums.js";
import { isPermissionKey, type PermissionKey } from "../permissions.js";
import type { Theme } from "../theme.js";
import { currencyCodeSchema, idSchema, minorAmountSchema } from "./common.js";

// ---- auth ----
export const loginInputSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});

export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(72), // bcrypt ignores bytes after 72
});

// ---- users ----
export const passwordSchema = z.string().min(10, "Use at least 10 characters").max(72);
export const pinSchema = z.string().regex(/^\d{4,8}$/, "PIN must be 4 to 8 digits");

export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().transform((e) => e.toLowerCase()),
  phone: z.string().trim().max(30).nullable().optional(),
  password: passwordSchema,
  roleIds: z.array(idSchema).min(1).max(10),
  allLocations: z.boolean().default(false),
  locationIds: z.array(idSchema).max(200).default([]),
  locale: z.string().trim().min(2).max(10).optional(),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  status: z.enum(USER_STATUSES).optional(),
  locale: z.string().trim().min(2).max(10).optional(),
});

export const userRolesInputSchema = z.object({ roleIds: z.array(idSchema).min(1).max(10) });
export const userLocationsInputSchema = z.object({
  allLocations: z.boolean(),
  locationIds: z.array(idSchema).max(200).default([]),
});
export const userPasswordResetSchema = z.object({ password: passwordSchema });
export const userPinInputSchema = z.object({ pin: pinSchema });

// ---- roles ----
export const roleInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).nullable().optional(),
  maxDiscountPercent: z.number().min(0).max(100).multipleOf(0.01).default(0),
});
export const roleUpdateSchema = roleInputSchema.partial();

export const rolePermissionsInputSchema = z.object({
  permissions: z
    .array(z.string())
    .max(300)
    .refine((list) => list.every(isPermissionKey), "Unknown permission in the list")
    .transform((list) => [...new Set(list)] as PermissionKey[]),
});

export const roleLimitInputSchema = z.object({
  currencyCode: currencyCodeSchema,
  voidLimitMinor: minorAmountSchema,
  refundLimitMinor: minorAmountSchema,
  poApprovalLimitMinor: minorAmountSchema,
  adjustmentLimitMinor: minorAmountSchema,
});
export const roleLimitsInputSchema = z.object({ limits: z.array(roleLimitInputSchema).max(20) });

// ---- approvals ----
export const approvalDecisionInputSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(300).optional(),
});

/** Inline manager override: the approver enters their email and POS PIN on the requester's device. */
export const approvalOverrideInputSchema = z.object({
  type: z.enum(APPROVAL_TYPES),
  approverEmail: z.email().transform((e) => e.toLowerCase()),
  pin: pinSchema,
  locationId: idSchema.nullable().optional(),
  entityType: z.string().trim().min(1).max(60),
  entityId: z.string().trim().max(80).nullable().optional(),
  payloadHash: z.string().trim().min(8).max(128),
  amountMinor: minorAmountSchema.nullable().optional(),
  /** For discounts: the percentage being approved, so the approver's own limit is enforced. */
  percent: z.number().min(0).max(100).nullable().optional(),
  currencyCode: currencyCodeSchema.nullable().optional(),
  reason: z.string().trim().min(3).max(300),
});

// ---- shape of GET /auth/me (used by the admin UI for permission-aware navigation) ----
export interface MeResponse {
  user: { id: string; name: string; email: string; phone: string | null; locale: string };
  tenant: { id: string; name: string; slug: string; baseCurrency: string; status: string; plan: string; theme: Theme };
  roles: { id: string; name: string }[];
  permissions: PermissionKey[];
  allLocations: boolean;
  locations: { id: string; code: string; name: string; type: string; brandId: string | null; currencyCode: string; timezone: string }[];
  maxDiscountPercent: number;
  unlimitedLimits: boolean;
  limits: Record<string, { voidLimitMinor: number; refundLimitMinor: number; poApprovalLimitMinor: number; adjustmentLimitMinor: number }>;
}
