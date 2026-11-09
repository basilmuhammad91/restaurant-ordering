import { describe, expect, it } from "vitest";
import { runWithContext, type RequestContext } from "../../src/core/context/context.js";
import { scopeArgs } from "../../src/core/db/scoped.js";
import { LOCATION_SCOPED, NOT_TENANT_SCOPED, allModelNames, metaFor, modelFields } from "../../src/core/db/meta.js";

// 1) The COVERAGE test: it fails the build if someone adds a model without tenant scoping.
describe("tenancy coverage (guards against a model silently skipping scoping)", () => {
  it("every model has a tenantId, or is on the explicit allow-list", () => {
    const unscoped = allModelNames().filter((m) => !modelFields(m).has("tenantId") && !NOT_TENANT_SCOPED.has(m));
    expect(unscoped, `Add tenantId to these models (or justify them in NOT_TENANT_SCOPED): ${unscoped.join(", ")}`).toEqual([]);
  });

  it("the allow-list only names models that exist and do NOT have a tenantId", () => {
    const names = new Set(allModelNames());
    for (const m of NOT_TENANT_SCOPED) {
      expect(names.has(m), `${m} is on the allow-list but is not a model`).toBe(true);
      expect(modelFields(m).has("tenantId"), `${m} has a tenantId, so it must not be allow-listed`).toBe(false);
    }
  });

  it("every model with a locationId column is declared location-scoped (or it would leak across branches)", () => {
    const missing = allModelNames().filter((m) => modelFields(m).has("locationId") && !LOCATION_SCOPED[m]);
    expect(missing, `Declare these in LOCATION_SCOPED: ${missing.join(", ")}`).toEqual([]);
  });

  it("every LOCATION_SCOPED entry points at a real column", () => {
    for (const [model, { field }] of Object.entries(LOCATION_SCOPED)) expect(modelFields(model).has(field), `${model}.${field}`).toBe(true);
  });

  it("detects soft delete from the deletedAt column", () => {
    expect(metaFor("Brand").softDelete).toBe(true);
    expect(metaFor("User").softDelete).toBe(true);
    expect(metaFor("AuditLog").softDelete).toBe(false); // ledgers are never soft deleted
    expect(metaFor("Session").softDelete).toBe(false);
  });
});

// 2) How the extension rewrites queries (pure function, no database).
const tenant = "11111111-1111-7111-8111-111111111111";
const ctx = (over: Partial<RequestContext> = {}): RequestContext => ({
  requestId: "t", tenantId: tenant, userId: "u", actorType: "USER", allLocations: true, locationIds: [], includeArchived: false, ...over,
});
const scope = (c: RequestContext, model: string, op: string, args: unknown) => runWithContext(c, () => scopeArgs(model, op, args)) as any;

describe("scopeArgs: tenant and soft delete", () => {
  it("adds the tenant and non-archived conditions to reads, keeping the caller's keys", () => {
    const out = scope(ctx(), "Brand", "findMany", { where: { name: "x" } });
    expect(out.where.name).toBe("x");
    expect(out.where.AND).toEqual([{ tenantId: tenant }, { deletedAt: null }]);
  });

  it("builds a where even when the caller gave none", () => {
    expect(scope(ctx(), "Brand", "findMany", undefined).where.AND).toEqual([{ tenantId: tenant }, { deletedAt: null }]);
  });

  it("keeps the unique field at the TOP LEVEL for update/delete/findUnique (a Prisma requirement)", () => {
    for (const op of ["update", "delete", "findUnique", "findUniqueOrThrow"]) {
      const out = scope(ctx(), "Brand", op, { where: { id: "abc" } });
      expect(out.where.id, op).toBe("abc");
      expect(out.where.AND, op).toContainEqual({ tenantId: tenant });
    }
  });

  it("preserves an existing AND instead of overwriting it", () => {
    const out = scope(ctx(), "Brand", "findMany", { where: { AND: [{ name: "a" }] } });
    expect(out.where.AND).toEqual([{ name: "a" }, { tenantId: tenant }, { deletedAt: null }]);
  });

  it("scopes counts, aggregates, updateMany and deleteMany too", () => {
    for (const op of ["count", "aggregate", "groupBy", "updateMany", "deleteMany", "findFirst"]) {
      expect(scope(ctx(), "Role", op, { where: {} }).where.AND, op).toContainEqual({ tenantId: tenant });
    }
  });

  it("stamps tenantId on creates and OVERRIDES a client-supplied tenant", () => {
    const out = scope(ctx(), "Brand", "create", { data: { name: "x", tenantId: "another-tenant" } });
    expect(out.data.tenantId).toBe(tenant);
  });

  it("stamps every row of createMany / createManyAndReturn", () => {
    const out = scope(ctx(), "Brand", "createMany", { data: [{ name: "a" }, { name: "b", tenantId: "evil" }] });
    expect(out.data.map((r: any) => r.tenantId)).toEqual([tenant, tenant]);
    expect(scope(ctx(), "Brand", "createManyAndReturn", { data: { name: "a" } }).data.tenantId).toBe(tenant);
  });

  it("stamps the create branch of an upsert", () => {
    const out = scope(ctx(), "Brand", "upsert", { where: { id: "1" }, create: { name: "n", tenantId: "evil" }, update: {} });
    expect(out.create.tenantId).toBe(tenant);
    expect(out.where.id).toBe("1");
  });

  it("shows archived rows only when the context says so, or when the caller filters deletedAt itself", () => {
    expect(scope(ctx({ includeArchived: true }), "Brand", "findMany", {}).where.AND).toEqual([{ tenantId: tenant }]);
    const explicit = scope(ctx(), "Brand", "findMany", { where: { deletedAt: { not: null } } });
    expect(explicit.where.AND).toEqual([{ tenantId: tenant }]);
  });

  it("does not soft-delete-filter ledger models", () => {
    expect(scope(ctx(), "AuditLog", "findMany", {}).where.AND).toEqual([{ tenantId: tenant }]);
  });

  it("scopes the Tenant model by its own id", () => {
    expect(scope(ctx(), "Tenant", "findUnique", { where: { id: "x" } }).where.AND).toEqual([{ id: tenant }]);
  });

  it("passes shared reference data and legacy tables through untouched", () => {
    const args = { where: { code: "PKR" } };
    expect(scopeArgs("Currency", "findMany", args)).toBe(args); // no context needed
    expect(scopeArgs("LegacyOrder", "findMany", args)).toBe(args);
  });

  it("FAILS CLOSED: a tenant-scoped query with no context throws instead of returning every row", () => {
    expect(() => scopeArgs("Brand", "findMany", {})).toThrow(/No request context/);
    expect(() => scopeArgs("User", "create", { data: {} })).toThrow(/No request context/);
  });
});

describe("scopeArgs: location (branch) scoping", () => {
  const limited = ctx({ allLocations: false, locationIds: ["loc-a", "loc-b"] });

  it("filters location-scoped reads to the user's branches", () => {
    const out = scope(limited, "DiningTable", "findMany", {});
    expect(out.where.AND).toContainEqual({ locationId: { in: ["loc-a", "loc-b"] } });
  });

  it("filters the Location model by its own id", () => {
    expect(scope(limited, "Location", "findMany", {}).where.AND).toContainEqual({ id: { in: ["loc-a", "loc-b"] } });
  });

  it("does not filter users who may see every location", () => {
    const conditions = scope(ctx(), "DiningTable", "findMany", {}).where.AND as Record<string, unknown>[];
    expect(conditions).toContainEqual({ tenantId: tenant });
    expect(conditions.some((c) => "locationId" in c)).toBe(false); // tenant + soft delete only, no branch filter
  });

  it("an empty branch list sees nothing, not everything", () => {
    const none = ctx({ allLocations: false, locationIds: [] });
    expect(scope(none, "DiningTable", "findMany", {}).where.AND).toContainEqual({ locationId: { in: [] } });
  });

  it("keeps company-wide rows (no location) visible for nullable location models", () => {
    const out = scope(limited, "Notification", "findMany", {});
    expect(out.where.AND).toContainEqual({ OR: [{ locationId: null }, { locationId: { in: ["loc-a", "loc-b"] } }] });
  });

  it("hides company-wide audit entries from branch-limited users (audit is strictly scoped)", () => {
    expect(scope(limited, "AuditLog", "findMany", {}).where.AND).toContainEqual({ locationId: { in: ["loc-a", "loc-b"] } });
  });

  it("refuses to create a row in a branch outside the user's access", () => {
    expect(() => scope(limited, "DiningTable", "create", { data: { locationId: "loc-z", name: "T1" } })).toThrow(/outside your access/);
    expect(scope(limited, "DiningTable", "create", { data: { locationId: "loc-a", name: "T1" } }).data.locationId).toBe("loc-a");
  });
});
