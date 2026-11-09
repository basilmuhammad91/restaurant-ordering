import type { PermissionKey } from "@restoflux/contracts";
import { unscopedDb } from "../db/client.js";

// The "principal" is everything the system needs to know about the caller to authorize an action:
// who they are, which permissions their roles grant (union), their approval limits, and which
// locations they may see. It is loaded on the server from the user id, never read from the token.
// (Laravel: like $request->user() with its loaded roles and permissions.)

export interface LimitSet {
  voidLimitMinor: number;
  refundLimitMinor: number;
  poApprovalLimitMinor: number;
  adjustmentLimitMinor: number;
}

export interface Principal {
  userId: string;
  tenantId: string;
  sessionId: string;
  name: string;
  email: string;
  roleIds: string[];
  roleNames: string[];
  permissions: ReadonlySet<string>;
  /** Holds an owner role (may manage owner roles). */
  isOwner: boolean;
  /** Any role is unlimited: amount thresholds do not apply (still audited). */
  unlimitedLimits: boolean;
  /** Highest manual discount percent across roles. */
  maxDiscountPercent: number;
  /** Per-currency limits: the highest value across the user's roles. Missing currency = no authority. */
  limits: Record<string, LimitSet>;
  allLocations: boolean;
  locationIds: string[];
}

export async function loadPrincipal(userId: string, sessionId: string): Promise<Principal> {
  const user = await unscopedDb.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      roles: {
        include: {
          role: { include: { permissions: true, limits: true } },
        },
      },
      locations: { select: { locationId: true } },
    },
  });

  const roles = user.roles.map((ur) => ur.role).filter((r) => r.deletedAt === null);
  const permissions = new Set<string>();
  const limits: Record<string, LimitSet> = {};
  let maxDiscountPercent = 0;

  for (const role of roles) {
    for (const p of role.permissions) permissions.add(p.permission);
    maxDiscountPercent = Math.max(maxDiscountPercent, Number(role.maxDiscountPercent));
    for (const l of role.limits) {
      const current = limits[l.currencyCode];
      limits[l.currencyCode] = {
        voidLimitMinor: Math.max(current?.voidLimitMinor ?? 0, l.voidLimitMinor),
        refundLimitMinor: Math.max(current?.refundLimitMinor ?? 0, l.refundLimitMinor),
        poApprovalLimitMinor: Math.max(current?.poApprovalLimitMinor ?? 0, l.poApprovalLimitMinor),
        adjustmentLimitMinor: Math.max(current?.adjustmentLimitMinor ?? 0, l.adjustmentLimitMinor),
      };
    }
  }

  return {
    userId: user.id,
    tenantId: user.tenantId,
    sessionId,
    name: user.name,
    email: user.email,
    roleIds: roles.map((r) => r.id),
    roleNames: roles.map((r) => r.name),
    permissions,
    isOwner: roles.some((r) => r.isOwner),
    unlimitedLimits: roles.some((r) => r.unlimitedLimits),
    maxDiscountPercent,
    limits,
    allLocations: user.allLocations,
    locationIds: user.locations.map((l) => l.locationId),
  };
}

export const can = (p: Pick<Principal, "permissions">, permission: PermissionKey): boolean => p.permissions.has(permission);

// ---- cache: the heavy load above is done once per (user, tenant authVersion) ----
// Any role/permission/access change bumps the tenant's authVersion, which changes the key, so the next
// request reloads. Entries for old versions are simply never used again and age out.

const cache = new Map<string, { principal: Principal; sessionId: string }>();
const MAX_ENTRIES = 1000;

export async function getPrincipal(userId: string, sessionId: string, authVersion: number): Promise<Principal> {
  const key = `${userId}:${authVersion}`;
  const hit = cache.get(key);
  if (hit) return hit.sessionId === sessionId ? hit.principal : { ...hit.principal, sessionId };

  const principal = await loadPrincipal(userId, sessionId);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { principal, sessionId });
  return principal;
}

export const clearPrincipalCache = () => cache.clear();
