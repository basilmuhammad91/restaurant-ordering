import { Router } from "express";
import { requestIdMiddleware, v1ErrorHandler, v1NotFound } from "./core/http/middleware.js";
import { securedRouter } from "./core/http/secured.js";
import { approvalsRouter } from "./modules/approvals/routes.js";
import { availabilityRouter, catalogRouter } from "./modules/catalog/availability.js";
import { combosRouter, menusRouter } from "./modules/catalog/combos-menus.js";
import { categories, modifierGroupsRouter, productsRouter } from "./modules/catalog/products.js";
import { pricesRouter } from "./modules/catalog/prices.js";
import { inventoryItemsRouter, productionRouter, recipesRouter, stockCountsRouter, stockRouter, stockTransfersRouter } from "./modules/inventory/routes.js";
import { goodsReceiptsRouter, purchaseOrdersRouter, suggestedOrdersRouter, supplierInvoicesRouter, supplierItemsRouter, suppliersRouter } from "./modules/purchasing/routes.js";
import { reportsExtraRouter } from "./modules/reports/routes.js";
import { couponsRouter, customerProfileRouter, customersRouter, feedbackRouter, loyaltyRouter, offersRouter, promotionsRouter } from "./modules/customers/routes.js";
import { deliveriesRouter, deliveryZonesRouter, employeesRouter, ridersRouter, rosterRouter, settingsRouter, timeclockRouter } from "./modules/operations/routes.js";
import { kitchenRouter } from "./modules/orders/kitchen.js";
import { posRouter } from "./modules/orders/pos.js";
import { ordersRouter } from "./modules/orders/routes.js";
import { dashboardRouter, registersRouter, reportsRouter, shiftsRouter, zReportsRouter } from "./modules/orders/shifts.js";
import { auditRouter } from "./modules/audit/routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { notificationsRouter } from "./modules/notifications/routes.js";
import { orgRouter } from "./modules/org/routes.js";
import { platformAudit, platformAuth, organizations as platformOrganizations, platformTeam } from "./modules/platform/routes.js";
import { permissionsRouter, rolesRouter } from "./modules/roles/routes.js";
import { usersRouter } from "./modules/users/routes.js";

// The multi-tenant API (/api/v1). Every route is declared through securedRouter(), which forces an
// explicit access declaration, so there is no route without a stated permission (or "public").
export const v1Router = Router();

v1Router.use(requestIdMiddleware);

const health = securedRouter("/api/v1/health");
health.get("/", "public", (_req, res) => {
  res.json({ data: { status: "ok" } });
});
v1Router.use("/health", health.router);

v1Router.use("/auth", authRouter);
v1Router.use("/platform/auth", platformAuth.router); // Restoflux team console (separate auth guard)
v1Router.use("/platform/organizations", platformOrganizations.router);
v1Router.use("/platform/audit-logs", platformAudit.router);
v1Router.use("/platform/admins", platformTeam.router);
v1Router.use(orgRouter); // brands, locations, taxes, payment methods, tenant, currencies ...
v1Router.use("/users", usersRouter);
v1Router.use("/roles", rolesRouter);
v1Router.use("/permissions", permissionsRouter);
v1Router.use("/approvals", approvalsRouter);
v1Router.use("/categories", categories);
v1Router.use("/products", productsRouter);
v1Router.use("/modifier-groups", modifierGroupsRouter);
v1Router.use("/combos", combosRouter);
v1Router.use("/menus", menusRouter);
v1Router.use("/prices", pricesRouter);
v1Router.use("/availability", availabilityRouter);
v1Router.use("/catalog", catalogRouter);
v1Router.use("/orders", ordersRouter);
v1Router.use("/pos", posRouter);
v1Router.use("/kds", kitchenRouter);
v1Router.use("/cash-registers", registersRouter);
v1Router.use("/shifts", shiftsRouter);
v1Router.use("/z-reports", zReportsRouter);
v1Router.use("/reports", reportsRouter);
v1Router.use("/reports", reportsExtraRouter);
v1Router.use("/dashboard", dashboardRouter);
v1Router.use("/inventory-items", inventoryItemsRouter);
v1Router.use("/inventory", stockRouter);
v1Router.use("/recipes", recipesRouter);
v1Router.use("/stock-counts", stockCountsRouter);
v1Router.use("/stock-transfers", stockTransfersRouter);
v1Router.use("/production", productionRouter);
v1Router.use("/suppliers", suppliersRouter);
v1Router.use("/supplier-items", supplierItemsRouter);
v1Router.use("/purchase-orders", purchaseOrdersRouter);
v1Router.use("/goods-receipts", goodsReceiptsRouter);
v1Router.use("/supplier-invoices", supplierInvoicesRouter);
v1Router.use("/suggested-orders", suggestedOrdersRouter);
v1Router.use("/customers", customersRouter);
v1Router.use("/customers", customerProfileRouter);
v1Router.use("/loyalty", loyaltyRouter);
v1Router.use("/coupons", couponsRouter);
v1Router.use("/promotions", promotionsRouter);
v1Router.use("/offers", offersRouter);
v1Router.use("/feedback", feedbackRouter);
v1Router.use("/delivery-zones", deliveryZonesRouter);
v1Router.use("/riders", ridersRouter);
v1Router.use("/deliveries", deliveriesRouter);
v1Router.use("/employees", employeesRouter);
v1Router.use("/roster", rosterRouter);
v1Router.use("/timeclock", timeclockRouter);
v1Router.use("/settings", settingsRouter);
v1Router.use("/audit-logs", auditRouter);
v1Router.use("/notifications", notificationsRouter);

v1Router.use(v1NotFound);
v1Router.use(v1ErrorHandler); // must be registered last
