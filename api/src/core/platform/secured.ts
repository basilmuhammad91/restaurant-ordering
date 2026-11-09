import { Router, type RequestHandler } from "express";
import { authenticatePlatform } from "./auth.js";

// Same idea as securedRouter() for tenant routes: a platform route must say "public" (login/refresh)
// or "platform" (any signed-in Restoflux team member). Recorded in platformRouteRegistry for tests.

export type PlatformAccess = "public" | "platform";
export interface PlatformRouteInfo {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  access: PlatformAccess;
}
export const platformRouteRegistry: PlatformRouteInfo[] = [];

export function platformRouter(basePath: string) {
  const router = Router();
  const add =
    (method: PlatformRouteInfo["method"]) =>
    (path: string, access: PlatformAccess, ...handlers: RequestHandler[]) => {
      platformRouteRegistry.push({ method, path: path === "/" ? basePath : `${basePath}${path}`, access });
      router[method](path, ...(access === "public" ? [] : [authenticatePlatform]), ...handlers);
    };
  return { router, get: add("get"), post: add("post"), put: add("put"), patch: add("patch"), delete: add("delete") };
}
