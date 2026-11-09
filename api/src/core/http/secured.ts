import type { PermissionKey } from "@restoflux/contracts";
import { Router, type RequestHandler } from "express";
import { authenticate } from "../auth/authenticate.js";
import { requirePermission } from "../rbac/require.js";

// Every route under /api/v1 is declared through this helper, so each one MUST state its access:
//   "public"            no login (login, refresh)
//   "authenticated"     any logged-in user (their own profile, notifications)
//   a permission, or a list of permissions (any one of them)
// Forgetting is impossible, because there is no way to add a route without saying who may call it.
// The declarations are also recorded in routeRegistry, which the permission and tenant-leak test
// matrices are generated from. (Laravel: Route::middleware('can:...') on every route + a route:list test.)

export type Access = "public" | "authenticated" | PermissionKey | PermissionKey[];

export interface RouteInfo {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  access: Access;
}

export const routeRegistry: RouteInfo[] = [];

const joinPath = (base: string, path: string) => (path === "/" ? base : `${base}${path}`);

export function securedRouter(basePath: string) {
  const router = Router();

  const add =
    (method: RouteInfo["method"]) =>
    (path: string, access: Access, ...handlers: RequestHandler[]) => {
      routeRegistry.push({ method, path: joinPath(basePath, path), access });
      const gates: RequestHandler[] =
        access === "public"
          ? []
          : access === "authenticated"
            ? [authenticate]
            : [authenticate, requirePermission(...(Array.isArray(access) ? access : [access]))];
      router[method](path, ...gates, ...handlers);
    };

  return {
    router,
    get: add("get"),
    post: add("post"),
    put: add("put"),
    patch: add("patch"),
    delete: add("delete"),
  };
}
