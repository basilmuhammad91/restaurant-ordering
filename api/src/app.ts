import cors from "cors";
import express from "express";
import { env } from "./core/config/env.js";
import { legacyRouter } from "./legacy/router.js";
import { v1Router } from "./v1.js";

// Build the app separately from listening, so tests can import it
// (Supertest drives it directly, no real port needed).
export function createApp() {
  const app = express();

  // CORS: browsers block a page on one origin from calling an API on another unless the API opts in.
  // `credentials: true` lets the admin app send the httpOnly refresh cookie.
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(express.json()); // parses JSON bodies, like Laravel does for you

  app.set("trust proxy", true); // correct client IPs behind Vercel's proxy (audit log, login history)

  // New multi-tenant API (staff / admin). Own envelope and error format.
  app.use("/api/v1", v1Router);

  // Legacy single-restaurant routes used by the storefront until Phase 3.
  app.use(legacyRouter);

  return app;
}
