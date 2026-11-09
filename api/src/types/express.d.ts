import type { AuthUser } from "../legacy/jwt.js";
import type { Principal } from "../core/rbac/principal.js";

// Teach TypeScript what our middleware adds to the request.
// (Laravel: like $request->user().)
declare global {
  namespace Express {
    interface Request {
      /** Legacy storefront auth (removed in Phase 3). */
      user?: AuthUser;
      /** /api/v1 staff auth: set by the `authenticate` middleware. */
      principal?: Principal;
      requestId: string;
    }
  }
}

export {};
