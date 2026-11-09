import type { AuthUser } from "../lib/jwt.js";

// Teach TypeScript that our auth middleware adds `req.user`
// (like Laravel's $request->user()).
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
