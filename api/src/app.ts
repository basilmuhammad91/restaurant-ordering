import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { authRouter } from "./routes/auth.js";
import { categoriesRouter } from "./routes/categories.js";
import { menuItemsRouter } from "./routes/menu-items.js";
import { ordersRouter } from "./routes/orders.js";
import { healthRouter } from "./routes/health.js";

// Build the app separately from listening, so tests can import it
// (Supertest drives it directly, no real port needed).
export function createApp() {
  const app = express();

  // CORS: browsers block a page on one origin from calling an API on another
  // unless the API opts in. Laravel ships this in config/cors.php.
  app.use(cors({ origin: env.CORS_ORIGINS }));

  app.use(express.json()); // parses JSON bodies, like Laravel does for you

  app.use("/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/menu-items", menuItemsRouter);
  app.use("/api/orders", ordersRouter);

  app.use(notFound);
  app.use(errorHandler); // must be registered last

  return app;
}
