import { requireContext } from "../context/context.js";
import type { Tx } from "../db/scoped.js";
import { AppError } from "../http/errors.js";

/**
 * Enforce the limits the platform team set for this organization (Tenant.maxLocations / maxUsers;
 * null = unlimited). Call before creating a location or a user. (Laravel: a plan-quota check in a policy.)
 */
export async function assertWithinPlanLimit(tx: Tx, what: "locations" | "users"): Promise<void> {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: requireContext().tenantId }, select: { maxLocations: true, maxUsers: true, plan: true } });
  const limit = what === "locations" ? tenant.maxLocations : tenant.maxUsers;
  if (limit === null) return;
  const used = what === "locations" ? await tx.location.count() : await tx.user.count();
  if (used >= limit) {
    throw new AppError(403, "PLAN_LIMIT", `Your ${tenant.plan} plan allows ${limit} ${what}. Ask Restoflux to raise the limit.`, { limit, used });
  }
}
