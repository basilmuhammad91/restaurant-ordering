import { DEFAULT_ROLES, PERMISSION_KEYS } from "@restoflux/contracts";
import { describe, expect, it } from "vitest";
import { NAV, allNavItems, visibleNav } from "../src/app/nav.config";
import { canAny } from "../src/lib/permissions";

const setOf = (keys: readonly string[]) => new Set(keys);
const role = (name: string) => setOf(DEFAULT_ROLES.find((r) => r.name === name)!.permissions);
const labels = (perms: Set<string>) => visibleNav(perms).flatMap((g) => g.items.map((i) => i.label));
const groups = (perms: Set<string>) => visibleNav(perms).map((g) => g.label);

// The routes that exist in App.tsx today. Everything else in the nav must be marked `soon`.
const BUILT = new Set([
  "/", "/approvals", "/org/brands", "/org/locations", "/org/taxes", "/org/payment-methods", "/org/price-books", "/org/tables",
  "/settings/organization", "/settings/users", "/settings/roles", "/settings/audit",
]);

describe("navigation config", () => {
  it("has unique paths and only real permissions", () => {
    const items = allNavItems();
    expect(new Set(items.map((i) => i.to)).size).toBe(items.length);
    for (const i of items) for (const p of i.anyOf ?? []) expect(PERMISSION_KEYS, `${i.label}: ${p}`).toContain(p);
  });

  it("every item that is not built yet is marked 'soon', and every built page is not", () => {
    for (const i of allNavItems()) expect(!!i.soon, `${i.label} (${i.to})`).toBe(!BUILT.has(i.to));
  });

  it("uses the group order from the spec", () => {
    expect(NAV.map((g) => g.label)).toEqual(["Overview", "Sales & Orders", "Menu", "Inventory", "Purchasing", "Customers & Marketing", "Delivery", "Staff", "Reports", "Organization", "Settings"]);
  });
});

describe("permission-aware navigation", () => {
  it("shows nothing to someone with no permissions", () => {
    expect(visibleNav(setOf([]))).toEqual([]);
  });

  it("shows the owner everything", () => {
    expect(groups(setOf(PERMISSION_KEYS))).toEqual(NAV.map((g) => g.label));
    expect(labels(setOf(PERMISSION_KEYS))).toHaveLength(allNavItems().length);
  });

  it("hides whole groups when no item is allowed", () => {
    const cashier = role("Cashier");
    expect(groups(cashier)).not.toContain("Settings");
    expect(groups(cashier)).not.toContain("Reports");
    expect(groups(cashier)).not.toContain("Organization");
    expect(labels(cashier)).toContain("POS");
  });

  it("kitchen staff see the kitchen display and nothing financial", () => {
    const kitchen = role("Kitchen Staff");
    expect(labels(kitchen)).toContain("Kitchen display");
    expect(labels(kitchen)).not.toContain("Users");
    expect(labels(kitchen)).not.toContain("Sales");
    expect(labels(kitchen)).not.toContain("Dashboard");
  });

  it("a branch manager sees users and the audit log but not roles or organization setup", () => {
    const manager = labels(role("Branch Manager"));
    expect(manager).toEqual(expect.arrayContaining(["Dashboard", "Users", "Audit log", "Approvals"]));
    expect(manager).not.toContain("Roles & permissions");
    expect(manager).toContain("Branches & warehouses"); // org.view is read-only visibility
  });

  it("an item with several permissions shows if the user holds any one", () => {
    expect(labels(setOf(["inventory.view"]))).toEqual(expect.arrayContaining(["Stock on hand", "Items"]));
    expect(labels(setOf(["items.manage"]))).toContain("Items");
    expect(labels(setOf(["items.manage"]))).not.toContain("Stock on hand");
  });

  it("canAny treats an empty or missing requirement as 'everyone'", () => {
    expect(canAny(setOf([]), undefined)).toBe(true);
    expect(canAny(setOf([]), [])).toBe(true);
    expect(canAny(setOf(["a"]), ["b", "a"] as never)).toBe(true);
    expect(canAny(setOf([]), ["a"] as never)).toBe(false);
  });
});
