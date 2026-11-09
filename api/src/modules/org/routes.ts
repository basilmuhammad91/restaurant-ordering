import {
  brandInputSchema, brandUpdateSchema, diningTableInputSchema, diningTableUpdateSchema, idSchema,
  kitchenStationInputSchema, kitchenStationUpdateSchema, locationInputSchema, locationPaymentMethodsInputSchema,
  locationUpdateSchema, openingHoursInputSchema, paymentMethodInputSchema, paymentMethodUpdateSchema,
  priceBookInputSchema, priceBookUpdateSchema, taxCategoryInputSchema, taxCategoryUpdateSchema,
  taxProfileInputSchema, taxProfileRulesInputSchema, taxProfileUpdateSchema, tenantSettingsSchema,
  tenantUpdateSchema, themeSchema, LOCATION_TYPES, PAYMENT_METHOD_TYPES, REASON_TYPES,
} from "@restoflux/contracts";
import { Router } from "express";
import { z } from "zod";
import { assertWithinPlanLimit } from "../../core/rbac/planLimits.js";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext } from "../../core/context/context.js";
import { db } from "../../core/db/scoped.js";
import { fieldError, forbidden, notFound } from "../../core/http/errors.js";
import { assertRef, boolQuery, defineResource } from "../../core/http/resource.js";
import { securedRouter } from "../../core/http/secured.js";

// ORGANIZATION: tenant profile, brands, locations, taxes, payment methods, tables, stations.

const idParams = z.object({ id: idSchema });

// ---- brands ----
const brands = defineResource({
  mount: "/api/v1/brands",
  label: "brand",
  entityType: "Brand",
  auditPrefix: "brands",
  model: (c) => c.brand as never,
  permissions: { read: "org.view", write: "org.manage" },
  createSchema: brandInputSchema,
  updateSchema: brandUpdateSchema,
  searchFields: ["name", "slug", "cuisine"],
  sortable: ["name", "createdAt"],
  defaultSort: "name",
  filters: { isActive: boolQuery.optional() },
});

// ---- price books (minimal until the catalog phase) ----
const priceBooks = defineResource({
  mount: "/api/v1/price-books",
  label: "price book",
  entityType: "PriceBook",
  auditPrefix: "price-books",
  model: (c) => c.priceBook as never,
  permissions: { read: "org.view", write: "org.manage" },
  createSchema: priceBookInputSchema,
  updateSchema: priceBookUpdateSchema,
  searchFields: ["name"],
  sortable: ["name", "currencyCode", "createdAt"],
  defaultSort: "name",
  filters: { brandId: idSchema.optional() },
  prepare: async (input, { tx }) => {
    if (input.currencyCode && !(await tx.currency.findUnique({ where: { code: input.currencyCode } }))) throw fieldError("currencyCode", "Unknown currency");
    await assertRef(tx.brand as never, input.brandId, "brand");
    return input;
  },
});

// ---- locations (branches, warehouses, central kitchens) ----
const SETTINGS_FIELDS = ["currencyCode", "timezone", "taxProfileId", "priceBookId"] as const;

const locations = defineResource({
  mount: "/api/v1/locations",
  label: "location",
  entityType: "Location",
  auditPrefix: "locations",
  model: (c) => c.location as never,
  permissions: { read: "org.view", write: "locations.manage" },
  createSchema: locationInputSchema,
  updateSchema: locationUpdateSchema,
  searchFields: ["name", "code", "city"],
  sortable: ["name", "code", "type", "createdAt"],
  defaultSort: "name",
  filters: { type: z.enum(LOCATION_TYPES).optional(), brandId: idSchema.optional(), isActive: boolQuery.optional() },
  include: { brand: { select: { id: true, name: true } } },
  locationIdOf: (row) => row.id,
  // Currency, timezone, tax profile and price book changes are logged under their own action so they stand out.
  updateAuditAction: (before, after) =>
    SETTINGS_FIELDS.some((f) => before[f] !== after[f]) ? "locations.settings.update" : "locations.update",
  prepare: async (input, { tx, existing }) => {
    const merged = { ...(existing ?? {}), ...input };
    // Creating a location widens the tenant's footprint: only users who can see every location may.
    if (!existing && !requireContext().allLocations) throw forbidden("Only users with access to all branches can create locations");
    if (!existing) await assertWithinPlanLimit(tx, "locations");

    if (merged.type === "BRANCH") {
      if (!merged.brandId) throw fieldError("brandId", "A branch needs a brand");
      if (!merged.taxProfileId) throw fieldError("taxProfileId", "A branch needs a tax profile");
      if (!merged.priceBookId) throw fieldError("priceBookId", "A branch needs a price book");
    }
    await assertRef(tx.brand as never, merged.brandId, "brand");
    await assertRef(tx.taxProfile as never, merged.taxProfileId, "taxProfile");
    const book = await assertRef(tx.priceBook as never, merged.priceBookId, "priceBook");
    if (book && book.currencyCode !== merged.currencyCode) throw fieldError("priceBookId", "The price book currency must match the location currency");
    if (!(await tx.currency.findUnique({ where: { code: merged.currencyCode } }))) throw fieldError("currencyCode", "Unknown currency");
    return input;
  },
});

const locationExtras = securedRouter("/api/v1/locations");

locationExtras.get("/:id/opening-hours", "org.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  if (!(await db.location.findFirst({ where: { id } }))) throw notFound("location");
  const hours = await db.locationOpeningHour.findMany({ where: { locationId: id }, orderBy: [{ weekday: "asc" }, { opensAt: "asc" }] });
  res.json({ data: hours });
});

locationExtras.put("/:id/opening-hours", "locations.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { hours } = openingHoursInputSchema.parse(req.body);
  const keys = new Set(hours.map((h) => `${h.weekday}|${h.opensAt}`));
  if (keys.size !== hours.length) throw fieldError("hours", "Two ranges start at the same time on the same day");

  const result = await db.$transaction(async (tx) => {
    if (!(await tx.location.findFirst({ where: { id } }))) throw notFound("location");
    const before = await tx.locationOpeningHour.findMany({ where: { locationId: id }, orderBy: [{ weekday: "asc" }, { opensAt: "asc" }] });
    await tx.locationOpeningHour.deleteMany({ where: { locationId: id } });
    if (hours.length) await tx.locationOpeningHour.createMany({ data: hours.map((h) => ({ ...h, tenantId: "", locationId: id })) });
    const after = await tx.locationOpeningHour.findMany({ where: { locationId: id }, orderBy: [{ weekday: "asc" }, { opensAt: "asc" }] });
    await recordAudit(tx, { action: "locations.opening-hours.update", entityType: "Location", entityId: id, before, after, locationId: id });
    return after;
  });
  res.json({ data: result });
});

locationExtras.get("/:id/payment-methods", "org.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  if (!(await db.location.findFirst({ where: { id } }))) throw notFound("location");
  const links = await db.locationPaymentMethod.findMany({ where: { locationId: id }, orderBy: { sortOrder: "asc" } });
  res.json({ data: links });
});

locationExtras.put("/:id/payment-methods", "locations.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { methods } = locationPaymentMethodsInputSchema.parse(req.body);
  if (new Set(methods.map((m) => m.paymentMethodId)).size !== methods.length) throw fieldError("methods", "A payment method is listed twice");

  const result = await db.$transaction(async (tx) => {
    if (!(await tx.location.findFirst({ where: { id } }))) throw notFound("location");
    for (const m of methods) await assertRef(tx.paymentMethod as never, m.paymentMethodId, "paymentMethod");
    const before = await tx.locationPaymentMethod.findMany({ where: { locationId: id } });
    await tx.locationPaymentMethod.deleteMany({ where: { locationId: id } });
    if (methods.length) await tx.locationPaymentMethod.createMany({ data: methods.map((m) => ({ ...m, tenantId: "", locationId: id })) });
    const after = await tx.locationPaymentMethod.findMany({ where: { locationId: id }, orderBy: { sortOrder: "asc" } });
    await recordAudit(tx, { action: "locations.payment-methods.update", entityType: "Location", entityId: id, before, after, locationId: id });
    return after;
  });
  res.json({ data: result });
});

// ---- dining tables and kitchen stations (branch level) ----
async function assertBranch(tx: typeof db, locationId: string | undefined) {
  const loc = await assertRef(tx.location as never, locationId, "location");
  if (loc && loc.type !== "BRANCH") throw fieldError("locationId", "Only branches have tables and stations");
}

const diningTables = defineResource({
  mount: "/api/v1/dining-tables",
  label: "table",
  entityType: "DiningTable",
  auditPrefix: "dining-tables",
  model: (c) => c.diningTable as never,
  permissions: { read: "org.view", write: "locations.manage" },
  createSchema: diningTableInputSchema,
  updateSchema: diningTableUpdateSchema,
  searchFields: ["name", "section"],
  sortable: ["name", "section", "seats", "createdAt"],
  defaultSort: "name",
  filters: { locationId: idSchema.optional(), isActive: boolQuery.optional() },
  locationIdOf: (row) => row.locationId,
  prepare: async (input, { tx }) => {
    if (input.locationId) await assertBranch(tx as never, input.locationId);
    return input;
  },
});

const kitchenStations = defineResource({
  mount: "/api/v1/kitchen-stations",
  label: "station",
  entityType: "KitchenStation",
  auditPrefix: "kitchen-stations",
  model: (c) => c.kitchenStation as never,
  permissions: { read: "org.view", write: "locations.manage" },
  createSchema: kitchenStationInputSchema,
  updateSchema: kitchenStationUpdateSchema,
  searchFields: ["name", "key"],
  sortable: ["name", "key", "sortOrder"],
  defaultSort: "sortOrder",
  filters: { locationId: idSchema.optional(), isActive: boolQuery.optional() },
  hardDelete: true,
  locationIdOf: (row) => row.locationId,
  prepare: async (input, { tx }) => {
    if (input.locationId) await assertBranch(tx as never, input.locationId);
    return input;
  },
});

// ---- taxes ----
const taxCategories = defineResource({
  mount: "/api/v1/tax-categories",
  label: "tax category",
  entityType: "TaxCategory",
  auditPrefix: "tax-categories",
  model: (c) => c.taxCategory as never,
  permissions: { read: "org.view", write: "taxes.manage" },
  createSchema: taxCategoryInputSchema,
  updateSchema: taxCategoryUpdateSchema,
  searchFields: ["name"],
  sortable: ["name", "createdAt"],
  defaultSort: "name",
});

const taxProfiles = defineResource({
  mount: "/api/v1/tax-profiles",
  label: "tax profile",
  entityType: "TaxProfile",
  auditPrefix: "tax-profiles",
  model: (c) => c.taxProfile as never,
  permissions: { read: "org.view", write: "taxes.manage" },
  createSchema: taxProfileInputSchema,
  updateSchema: taxProfileUpdateSchema,
  searchFields: ["name"],
  sortable: ["name", "countryCode", "createdAt"],
  defaultSort: "name",
  include: { rules: { orderBy: { sortOrder: "asc" } } },
});

const taxExtras = securedRouter("/api/v1/tax-profiles");

// Replace the whole rule set of a profile in one call (the UI edits the list as a unit).
taxExtras.put("/:id/rules", "taxes.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { rules } = taxProfileRulesInputSchema.parse(req.body);

  const result = await db.$transaction(async (tx) => {
    if (!(await tx.taxProfile.findFirst({ where: { id } }))) throw notFound("tax profile");
    for (const r of rules) await assertRef(tx.taxCategory as never, r.taxCategoryId, "taxCategory");
    const before = await tx.taxRule.findMany({ where: { taxProfileId: id }, orderBy: { sortOrder: "asc" } });
    await tx.taxRule.deleteMany({ where: { taxProfileId: id } });
    if (rules.length) {
      await tx.taxRule.createMany({ data: rules.map((r) => ({ ...r, taxCategoryId: r.taxCategoryId ?? null, tenantId: "", taxProfileId: id })) });
    }
    const after = await tx.taxRule.findMany({ where: { taxProfileId: id }, orderBy: { sortOrder: "asc" } });
    await recordAudit(tx, { action: "tax-profiles.rules.update", entityType: "TaxProfile", entityId: id, before, after });
    return after;
  });
  res.json({ data: result });
});

// ---- payment methods ----
const paymentMethods = defineResource({
  mount: "/api/v1/payment-methods",
  label: "payment method",
  entityType: "PaymentMethod",
  auditPrefix: "payment-methods",
  model: (c) => c.paymentMethod as never,
  permissions: { read: "org.view", write: "payment-methods.manage" },
  createSchema: paymentMethodInputSchema,
  updateSchema: paymentMethodUpdateSchema,
  searchFields: ["name", "providerCode"],
  sortable: ["name", "type", "createdAt"],
  defaultSort: "name",
  filters: { type: z.enum(PAYMENT_METHOD_TYPES).optional(), isActive: boolQuery.optional() },
});

// ---- reason codes (read-only for now; editing arrives with the POS) ----
const reasonCodes = defineResource({
  mount: "/api/v1/reason-codes",
  label: "reason code",
  entityType: "ReasonCode",
  auditPrefix: "reason-codes",
  model: (c) => c.reasonCode as never,
  permissions: { read: "org.view", write: "settings.manage" },
  searchFields: ["name", "code"],
  sortable: ["name", "code", "type"],
  defaultSort: "name",
  filters: { type: z.enum(REASON_TYPES).optional() },
});

// ---- tenant profile and settings ----
const tenantRoutes = securedRouter("/api/v1/tenant");

tenantRoutes.get("/", "org.view", async (_req, res) => {
  const tenant = await db.tenant.findUnique({ where: { id: requireContext().tenantId } });
  if (!tenant) throw notFound("tenant");
  res.json({ data: { ...tenant, settings: tenantSettingsSchema.parse(tenant.settings ?? {}), theme: themeSchema.catch({}).parse(tenant.theme ?? {}) } });
});

tenantRoutes.patch("/", "org.manage", async (req, res) => {
  const input = tenantUpdateSchema.parse(req.body);
  const result = await db.$transaction(async (tx) => {
    const id = requireContext().tenantId;
    const before = await tx.tenant.findUniqueOrThrow({ where: { id } });
    const settings = input.settings ? tenantSettingsSchema.parse({ ...(before.settings as object), ...input.settings }) : undefined;
    const after = await tx.tenant.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.defaultLocale !== undefined && { defaultLocale: input.defaultLocale }),
        ...(settings && { settings }),
        ...(input.theme !== undefined && { theme: input.theme }),
      },
    });
    await recordAudit(tx, { action: "tenant.update", entityType: "Tenant", entityId: id, before, after });
    return after;
  });
  res.json({ data: { ...result, settings: tenantSettingsSchema.parse(result.settings ?? {}), theme: themeSchema.catch({}).parse(result.theme ?? {}) } });
});

// ---- currencies (shared reference data, for dropdowns) ----
const currencyRoutes = securedRouter("/api/v1/currencies");
currencyRoutes.get("/", "authenticated", async (_req, res) => {
  res.json({ data: await db.currency.findMany({ orderBy: { code: "asc" } }) });
});

export const orgRouter = Router();
orgRouter.use("/brands", brands);
orgRouter.use("/price-books", priceBooks);
orgRouter.use("/locations", locationExtras.router, locations);
orgRouter.use("/dining-tables", diningTables);
orgRouter.use("/kitchen-stations", kitchenStations);
orgRouter.use("/tax-categories", taxCategories);
orgRouter.use("/tax-profiles", taxExtras.router, taxProfiles);
orgRouter.use("/payment-methods", paymentMethods);
orgRouter.use("/reason-codes", reasonCodes);
orgRouter.use("/tenant", tenantRoutes.router);
orgRouter.use("/currencies", currencyRoutes.router);
