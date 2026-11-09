import { DEFAULT_ROLES, OWNER_ROLE_NAME, PERMISSION_CATALOG, PERMISSION_KEYS, isPermissionKey, permissionsByModule, rolePermissionsInputSchema, roleLimitsInputSchema } from "@restoflux/contracts";
import { describe, expect, it } from "vitest";

describe("permission catalog", () => {
  it("has unique, well-formed module.action keys", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const key of PERMISSION_KEYS) expect(key).toMatch(/^[a-z-]+(\.[a-z-]+){1,2}$/);
  });

  it("describes every permission and groups them by module", () => {
    for (const p of PERMISSION_CATALOG) expect(p.description.length).toBeGreaterThan(5);
    const grouped = permissionsByModule().flatMap((g) => g.permissions.map((p) => p.key));
    expect(grouped).toEqual([...PERMISSION_KEYS]);
  });

  it("isPermissionKey only accepts catalog keys", () => {
    expect(isPermissionKey("orders.void")).toBe(true);
    expect(isPermissionKey("orders.destroy-everything")).toBe(false);
  });

  it("covers every permission named in the spec's default role matrix", () => {
    for (const key of ["inventory.adjust", "purchasing.approve", "reports.financial.view", "orders.void", "menu.availability.toggle", "approvals.decide"]) {
      expect(isPermissionKey(key)).toBe(true);
    }
  });
});

describe("default roles", () => {
  it("only use permissions from the catalog", () => {
    for (const role of DEFAULT_ROLES) for (const p of role.permissions) expect(isPermissionKey(p), `${role.name}: ${p}`).toBe(true);
  });

  it("has the eight roles from the spec, with unique names", () => {
    expect(DEFAULT_ROLES.map((r) => r.name)).toEqual(["Owner", "Head Office Admin", "Area Manager", "Branch Manager", "Cashier", "Kitchen Staff", "Inventory Clerk", "Rider"]);
  });

  it("has exactly one owner role, holding every permission with unlimited authority", () => {
    const owners = DEFAULT_ROLES.filter((r) => r.isOwner);
    expect(owners).toHaveLength(1);
    expect(owners[0]!.name).toBe(OWNER_ROLE_NAME);
    expect(owners[0]!.permissions).toHaveLength(PERMISSION_KEYS.length);
    expect(owners[0]!.unlimitedLimits).toBe(true);
    expect(owners[0]!.maxDiscountPercent).toBe(100);
  });

  it("keeps least privilege where it matters", () => {
    const byName = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.name, new Set<string>(r.permissions)]));
    expect(byName["Cashier"]!.has("orders.void")).toBe(false); // cashiers request voids, managers approve
    expect(byName["Cashier"]!.has("reports.financial.view")).toBe(false);
    expect(byName["Kitchen Staff"]!.has("menu.price.edit")).toBe(false);
    expect(byName["Kitchen Staff"]!.has("menu.availability.toggle")).toBe(true); // can 86 an item
    expect(byName["Branch Manager"]!.has("roles.manage")).toBe(false);
    expect(byName["Inventory Clerk"]!.has("purchasing.approve")).toBe(false);
  });

  it("has sane thresholds: whole non-negative minor units, and unlimited roles carry none", () => {
    for (const role of DEFAULT_ROLES) {
      expect(role.maxDiscountPercent).toBeGreaterThanOrEqual(0);
      expect(role.maxDiscountPercent).toBeLessThanOrEqual(100);
      if (role.unlimitedLimits) expect(Object.keys(role.limits)).toHaveLength(0);
      for (const l of Object.values(role.limits)) {
        for (const v of Object.values(l)) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(2_147_483_647);
        }
      }
    }
  });

  it("gives branch managers a smaller discount and void authority than area managers", () => {
    const am = DEFAULT_ROLES.find((r) => r.name === "Area Manager")!;
    const bm = DEFAULT_ROLES.find((r) => r.name === "Branch Manager")!;
    expect(bm.maxDiscountPercent).toBeLessThan(am.maxDiscountPercent);
    for (const currency of ["PKR", "AED", "USD"]) expect(bm.limits[currency]!.voidLimitMinor).toBeLessThan(am.limits[currency]!.voidLimitMinor);
  });
});

describe("role input schemas", () => {
  it("rejects unknown permissions and removes duplicates", () => {
    expect(rolePermissionsInputSchema.safeParse({ permissions: ["orders.view", "nope.nothing"] }).success).toBe(false);
    const ok = rolePermissionsInputSchema.parse({ permissions: ["orders.view", "orders.view", "menu.view"] });
    expect(ok.permissions).toEqual(["orders.view", "menu.view"]);
  });

  it("limits must be whole non-negative amounts with a valid currency code", () => {
    const base = { currencyCode: "PKR", voidLimitMinor: 100, refundLimitMinor: 100, poApprovalLimitMinor: 100, adjustmentLimitMinor: 100 };
    expect(roleLimitsInputSchema.safeParse({ limits: [base] }).success).toBe(true);
    expect(roleLimitsInputSchema.safeParse({ limits: [{ ...base, voidLimitMinor: -1 }] }).success).toBe(false);
    expect(roleLimitsInputSchema.safeParse({ limits: [{ ...base, voidLimitMinor: 1.5 }] }).success).toBe(false);
    expect(roleLimitsInputSchema.safeParse({ limits: [{ ...base, currencyCode: "pk" }] }).success).toBe(false);
  });
});
