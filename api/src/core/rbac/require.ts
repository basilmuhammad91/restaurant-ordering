import type { PermissionKey } from "@restoflux/contracts";
import type { RequestHandler } from "express";
import { forbidden, unauthenticated } from "../http/errors.js";

/**
 * Route gate: the caller must hold AT LEAST ONE of the listed permissions.
 * (Laravel: ->middleware('can:orders.void').) The backend is the real gate; the UI only hides buttons.
 */
export function requirePermission(...permissions: PermissionKey[]): RequestHandler {
  const gate: RequestHandler = (req, _res, next) => {
    const principal = req.principal;
    if (!principal) throw unauthenticated();
    if (!permissions.some((p) => principal.permissions.has(p))) throw forbidden();
    next();
  };
  return gate;
}
