import type { MeResponse, PermissionKey } from "@restoflux/contracts";

// Permission checks for the UI. These only decide what to SHOW; the API re-checks every request,
// so hiding a button is a convenience, never the security boundary.

export type PermissionSet = ReadonlySet<string>;

export const toPermissionSet = (me: Pick<MeResponse, "permissions"> | null): PermissionSet => new Set(me?.permissions ?? []);

export const can = (set: PermissionSet, permission: PermissionKey): boolean => set.has(permission);

/** True if the user holds at least one of the permissions. An empty list means "no requirement". */
export const canAny = (set: PermissionSet, permissions: readonly PermissionKey[] | undefined): boolean =>
  !permissions || permissions.length === 0 || permissions.some((p) => set.has(p));
