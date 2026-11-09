import { randomUUID } from "node:crypto";
import { CURRENCIES, DEFAULT_ROLES, OWNER_ROLE_NAME, type PaymentMethodType, type ReasonType } from "@restoflux/contracts";
import { hashPassword } from "../../core/auth/passwords.js";
import { recordAudit } from "../../core/audit/audit.js";
import { runAsTenant } from "../../core/context/context.js";
import { unscopedDb } from "../../core/db/client.js";
import { db } from "../../core/db/scoped.js";

// PROVISIONING: creating a tenant and everything a new company needs on day one.
// Used by the create-tenant CLI, the default-tenant bootstrap, the demo seed and test fixtures.
// (Laravel: a TenantCreated listener that runs the RoleSeeder and default settings for the new company.)

/** Shared reference data. Safe to run repeatedly. */
export async function seedCurrencies(): Promise<void> {
  for (const c of CURRENCIES) {
    await unscopedDb.currency.upsert({ where: { code: c.code }, update: {}, create: { ...c } });
  }
}

const DEFAULT_PAYMENT_METHODS: { name: string; type: PaymentMethodType; providerCode?: string; opensDrawer?: boolean; requiresReference?: boolean }[] = [
  { name: "Cash", type: "CASH", opensDrawer: true },
  { name: "Card", type: "CARD", requiresReference: true },
  { name: "Mobile wallet", type: "WALLET", requiresReference: true },
  { name: "QR payment", type: "QR", requiresReference: true },
  { name: "Bank transfer", type: "BANK_TRANSFER", requiresReference: true },
];

const DEFAULT_REASONS: { type: ReasonType; code: string; name: string; requiresNote?: boolean; isSystem?: boolean }[] = [
  { type: "VOID", code: "CUSTOMER_CHANGED_MIND", name: "Customer changed their mind" },
  { type: "VOID", code: "WRONG_ITEM", name: "Wrong item entered" },
  { type: "VOID", code: "KITCHEN_ERROR", name: "Kitchen error" },
  { type: "VOID", code: "LONG_WAIT", name: "Customer waited too long" },
  { type: "VOID", code: "OTHER", name: "Other", requiresNote: true },
  { type: "REFUND", code: "QUALITY", name: "Food quality complaint" },
  { type: "REFUND", code: "WRONG_ORDER", name: "Wrong order delivered" },
  { type: "REFUND", code: "OVERCHARGE", name: "Overcharged" },
  { type: "REFUND", code: "OTHER", name: "Other", requiresNote: true },
  { type: "DISCOUNT", code: "MANAGER_COMP", name: "Manager complimentary" },
  { type: "DISCOUNT", code: "STAFF_MEAL", name: "Staff meal" },
  { type: "DISCOUNT", code: "COMPLAINT", name: "Complaint recovery" },
  { type: "DISCOUNT", code: "OTHER", name: "Other", requiresNote: true },
  { type: "ADJUSTMENT", code: "WASTE", name: "Waste", isSystem: true },
  { type: "ADJUSTMENT", code: "EXPIRY", name: "Expired", isSystem: true },
  { type: "ADJUSTMENT", code: "STAFF_MEAL", name: "Staff meal", isSystem: true },
  { type: "ADJUSTMENT", code: "DAMAGE", name: "Damaged", isSystem: true },
  { type: "ADJUSTMENT", code: "THEFT", name: "Theft", isSystem: true },
  { type: "ADJUSTMENT", code: "OTHER", name: "Other", requiresNote: true, isSystem: true },
  { type: "CASH_OUT", code: "SUPPLIER_PAYMENT", name: "Supplier payment" },
  { type: "CASH_OUT", code: "PETTY_CASH", name: "Petty cash" },
  { type: "CASH_OUT", code: "TIP_PAYOUT", name: "Tip payout" },
  { type: "CASH_OUT", code: "OTHER", name: "Other", requiresNote: true },
];

export interface CreateTenantInput {
  name: string;
  slug: string;
  baseCurrency: string;
  defaultLocale?: string;
  owner: { name: string; email: string; password: string };
  /** Commercial settings, set by the platform team (defaults: active, standard plan, no limits). */
  status?: "TRIAL" | "ACTIVE" | "SUSPENDED";
  plan?: string;
  trialEndsAt?: Date | null;
  maxLocations?: number | null;
  maxUsers?: number | null;
}

export interface CreatedTenant {
  tenantId: string;
  ownerUserId: string;
  roleIds: Record<string, string>;
}

/**
 * Create a tenant with default roles (+ permissions and limits), payment methods, reason codes and an
 * Owner user. One transaction: it either all exists or none of it does.
 */
export async function createTenant(input: CreateTenantInput): Promise<CreatedTenant> {
  if (input.owner.password.length < 12) throw new Error("The owner's password must be at least 12 characters");
  await seedCurrencies();

  const tenant = await unscopedDb.tenant.create({
    data: {
      name: input.name, slug: input.slug, baseCurrency: input.baseCurrency, defaultLocale: input.defaultLocale ?? "en",
      ...(input.status ? { status: input.status } : {}),
      ...(input.plan ? { plan: input.plan } : {}),
      ...(input.trialEndsAt !== undefined ? { trialEndsAt: input.trialEndsAt } : {}),
      ...(input.maxLocations !== undefined ? { maxLocations: input.maxLocations } : {}),
      ...(input.maxUsers !== undefined ? { maxUsers: input.maxUsers } : {}),
    },
  });

  const passwordHash = await hashPassword(input.owner.password);

  return runAsTenant(tenant.id, () =>
    db.$transaction(async (tx) => {
      // Few round trips on purpose: everything per table in one createMany (the database is remote).
      const roleIds: Record<string, string> = {};
      for (const def of DEFAULT_ROLES) roleIds[def.name] = randomUUID();
      await tx.role.createMany({
        data: DEFAULT_ROLES.map((def) => ({
          id: roleIds[def.name]!, tenantId: tenant.id, name: def.name, description: def.description, isSystem: def.isSystem,
          isOwner: def.isOwner, unlimitedLimits: def.unlimitedLimits, maxDiscountPercent: def.maxDiscountPercent,
        })),
      });
      await tx.rolePermission.createMany({
        data: DEFAULT_ROLES.flatMap((def) => def.permissions.map((permission) => ({ tenantId: tenant.id, roleId: roleIds[def.name]!, permission }))),
      });
      const limitRows = DEFAULT_ROLES.flatMap((def) =>
        Object.entries(def.limits).map(([currencyCode, l]) => ({ tenantId: tenant.id, roleId: roleIds[def.name]!, currencyCode, ...l })),
      );
      if (limitRows.length) await tx.roleLimit.createMany({ data: limitRows });

      await tx.paymentMethod.createMany({ data: DEFAULT_PAYMENT_METHODS.map((m) => ({ tenantId: tenant.id, ...m })) });
      await tx.reasonCode.createMany({ data: DEFAULT_REASONS.map((r) => ({ tenantId: tenant.id, ...r })) });

      const owner = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.owner.email.toLowerCase(),
          name: input.owner.name,
          passwordHash,
          allLocations: true,
          roles: { create: [{ roleId: roleIds[OWNER_ROLE_NAME]! }] },
        },
      });
      await recordAudit(tx, { action: "tenant.create", entityType: "Tenant", entityId: tenant.id, after: { name: tenant.name, slug: tenant.slug, ownerEmail: owner.email } });
      return { tenantId: tenant.id, ownerUserId: owner.id, roleIds };
    }),
  );
}
