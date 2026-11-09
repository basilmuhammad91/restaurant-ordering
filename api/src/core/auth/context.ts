import type { RequestContext } from "../context/context.js";
import type { Principal } from "../rbac/principal.js";

/** The request context (tenant + branch scope) that corresponds to an authenticated principal. */
export function contextFromPrincipal(
  principal: Principal,
  extra: { requestId: string; ip?: string | undefined; userAgent?: string | undefined },
): RequestContext {
  return {
    requestId: extra.requestId,
    tenantId: principal.tenantId,
    userId: principal.userId,
    actorType: "USER",
    allLocations: principal.allLocations,
    locationIds: principal.locationIds,
    includeArchived: false,
    ip: extra.ip,
    userAgent: extra.userAgent,
  };
}
