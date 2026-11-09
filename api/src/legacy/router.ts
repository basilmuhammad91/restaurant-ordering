import { Router } from "express";
import { errorHandler, notFound } from "./middleware/error.js";
import { authRouter } from "./routes/auth.js";
import { categoriesRouter } from "./routes/categories.js";
import { dealsRouter } from "./routes/deals.js";
import { healthRouter } from "./routes/health.js";
import { menuItemsRouter } from "./routes/menu-items.js";
import { ordersRouter } from "./routes/orders.js";
import { statsRouter } from "./routes/stats.js";

// The original single-restaurant API used by the storefront (web/). It keeps its own error format and
// is deleted in Phase 3, when orders and customers move to the new model (docs/DATA_MODEL.md section 6).
export const legacyRouter = Router();

legacyRouter.use("/health", healthRouter);
legacyRouter.use("/api/auth", authRouter);
legacyRouter.use("/api/categories", categoriesRouter);
legacyRouter.use("/api/menu-items", menuItemsRouter);
legacyRouter.use("/api/orders", ordersRouter);
legacyRouter.use("/api/deals", dealsRouter);
legacyRouter.use("/api/stats", statsRouter);

legacyRouter.use(notFound);
legacyRouter.use(errorHandler); // must be registered last
