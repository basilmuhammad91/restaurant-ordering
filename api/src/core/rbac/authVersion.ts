import { requireContext } from "../context/context.js";
import type { Tx } from "../db/scoped.js";

/**
 * Invalidate every cached principal of the tenant: call after ANY change to roles, permissions,
 * limits, user-role links, user branch access or user status. The next request of every affected
 * user reloads their principal, so changes apply immediately (not when a token expires).
 */
export async function bumpAuthVersion(tx: Pick<Tx, "tenant">): Promise<void> {
  await tx.tenant.update({ where: { id: requireContext().tenantId }, data: { authVersion: { increment: 1 } } });
}
