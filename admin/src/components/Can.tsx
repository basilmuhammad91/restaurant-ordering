import type { PermissionKey } from "@restoflux/contracts";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

/**
 * Render children only if the user holds the permission (or at least one of several).
 * Hiding is a courtesy: the API re-checks every request.
 * (Laravel: @can('orders.void') ... @endcan)
 */
export function Can({ permission, anyOf, children, fallback = null }: { permission?: PermissionKey; anyOf?: PermissionKey[]; children: ReactNode; fallback?: ReactNode }) {
  const { can, canAny } = useAuth();
  const allowed = permission ? can(permission) : canAny(anyOf ?? []);
  return <>{allowed ? children : fallback}</>;
}
