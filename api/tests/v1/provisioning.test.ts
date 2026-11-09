import { DEFAULT_ROLES, PERMISSION_KEYS } from "@restoflux/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unscopedDb } from "../../src/core/db/client.js";
import { purgeTenant } from "../../src/core/db/purge.js";
import { createTenant } from "../../src/modules/org/provision.js";
import { createFixture, type Fixture } from "../helpers/fixtures.js";

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture();
});
afterAll(async () => {
  await fx.cleanup();
  await unscopedDb.$disconnect();
});

describe("tenant provisioning", () => {
  it("creates every default role with its permissions and limits", async () => {
    const roles = await unscopedDb.role.findMany({ where: { tenantId: fx.tenantId }, include: { permissions: true, limits: true } });
    expect(roles.map((r) => r.name).sort()).toEqual(DEFAULT_ROLES.map((r) => r.name).sort());
    for (const def of DEFAULT_ROLES) {
      const row = roles.find((r) => r.name === def.name)!;
      expect(row.permissions.map((p) => p.permission).sort(), def.name).toEqual([...def.permissions].sort());
      expect(row.isOwner).toBe(def.isOwner);
      expect(row.unlimitedLimits).toBe(def.unlimitedLimits);
      expect(Number(row.maxDiscountPercent)).toBe(def.maxDiscountPercent);
      expect(row.limits.map((l) => l.currencyCode).sort(), def.name).toEqual(Object.keys(def.limits).sort());
    }
    expect(roles.find((r) => r.isOwner)!.permissions).toHaveLength(PERMISSION_KEYS.length);
  });

  it("creates the owner with the owner role and access to every branch", async () => {
    const owner = await unscopedDb.user.findUniqueOrThrow({ where: { id: fx.ownerUserId }, include: { roles: { include: { role: true } } } });
    expect(owner).toMatchObject({ email: fx.ownerEmail, allLocations: true, status: "ACTIVE" });
    expect(owner.roles.map((r) => r.role.name)).toEqual(["Owner"]);
    expect(owner.passwordHash).not.toContain(fx.ownerPassword);
  });

  it("creates payment methods and reason codes, and an audit record", async () => {
    expect(await unscopedDb.paymentMethod.count({ where: { tenantId: fx.tenantId } })).toBe(5);
    const reasons = await unscopedDb.reasonCode.findMany({ where: { tenantId: fx.tenantId } });
    expect(new Set(reasons.map((r) => r.type))).toEqual(new Set(["VOID", "REFUND", "DISCOUNT", "ADJUSTMENT", "CASH_OUT"]));
    const audit = await unscopedDb.auditLog.findMany({ where: { tenantId: fx.tenantId, action: "tenant.create" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorType).toBe("SYSTEM");
  });

  it("refuses a weak owner password and a duplicate slug, and creates nothing in either case", async () => {
    await expect(createTenant({ name: "Weak", slug: `weak-${fx.slug}`, baseCurrency: "PKR", owner: { name: "W", email: `w@${fx.slug}.test`, password: "short" } })).rejects.toThrow(/12 characters/);
    expect(await unscopedDb.tenant.count({ where: { slug: `weak-${fx.slug}` } })).toBe(0);
    await expect(createTenant({ name: "Dup", slug: fx.slug, baseCurrency: "PKR", owner: { name: "D", email: `d@${fx.slug}.test`, password: "Twelve-chars-pw1" } })).rejects.toThrow();
  });

  it("is atomic: a failure after the tenant row exists is not left half-created", { timeout: 300_000 }, async () => {
    // owner email already taken (globally unique): the transaction inside createTenant fails
    const slug = `atomic-${fx.slug}`;
    await expect(createTenant({ name: "Atomic", slug, baseCurrency: "PKR", owner: { name: "O", email: fx.ownerEmail, password: "Twelve-chars-pw1" } })).rejects.toThrow();
    const orphan = await unscopedDb.tenant.findUnique({ where: { slug } });
    // the tenant row is created first (outside the role/user transaction); it must not own any roles or users
    if (orphan) {
      expect(await unscopedDb.role.count({ where: { tenantId: orphan.id } })).toBe(0);
      expect(await unscopedDb.user.count({ where: { tenantId: orphan.id } })).toBe(0);
      await purgeTenant(orphan.id);
    }
  });

  it("seeds the shared currencies, with the right minor-unit exponents", async () => {
    const byCode = Object.fromEntries((await unscopedDb.currency.findMany()).map((c) => [c.code, c.minorUnitExponent]));
    expect(byCode).toMatchObject({ PKR: 2, AED: 2, USD: 2, KWD: 3 });
  });
});

describe("database-level guarantees", () => {
  it("enforces the CHECK constraints", async () => {
    await expect(unscopedDb.$executeRaw`UPDATE users SET email = 'UPPER@CASE.TEST' WHERE id = ${fx.ownerUserId}::uuid`).rejects.toThrow();
    await expect(
      unscopedDb.location.create({ data: { tenantId: fx.tenantId, type: "BRANCH", code: "NOBRAND", name: "x", countryCode: "PK", timezone: "Asia/Karachi", currencyCode: "PKR" } }),
    ).rejects.toThrow(); // a BRANCH must have a brand
  });

  it("purging removes the tenant and everything it owns, and nothing else", { timeout: 300_000 }, async () => {
    const other = await createFixture();
    await purgeTenant(other.tenantId);
    expect(await unscopedDb.tenant.count({ where: { id: other.tenantId } })).toBe(0);
    expect(await unscopedDb.user.count({ where: { tenantId: other.tenantId } })).toBe(0);
    expect(await unscopedDb.auditLog.count({ where: { tenantId: other.tenantId } })).toBe(0);
    // the other fixture is untouched
    expect(await unscopedDb.user.count({ where: { tenantId: fx.tenantId } })).toBe(1);
  });
});
