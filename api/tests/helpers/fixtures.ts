import { randomBytes } from "node:crypto";
import type { PermissionKey } from "@restoflux/contracts";
import type { Express } from "express";
import request from "supertest";
import { hashPassword } from "../../src/core/auth/passwords.js";
import { runAsTenant } from "../../src/core/context/context.js";
import { db } from "../../src/core/db/scoped.js";
import { purgeTenant } from "../../src/core/db/purge.js";
import { createTenant } from "../../src/modules/org/provision.js";

// Test helpers. Every test FILE creates its own tenant, so files can run in parallel against the same
// database without ever touching each other's data (this is also what the tenancy design makes easy).

export interface Fixture {
  tenantId: string;
  slug: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerPassword: string;
  roleIds: Record<string, string>;
  cleanup: () => Promise<void>;
}

export async function createFixture(): Promise<Fixture> {
  const slug = `t${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const ownerEmail = `owner@${slug}.test`;
  const ownerPassword = "Owner-Passw0rd-1234";
  const created = await createTenant({ name: `Test ${slug}`, slug, baseCurrency: "PKR", owner: { name: "Test Owner", email: ownerEmail, password: ownerPassword } });
  return { tenantId: created.tenantId, slug, ownerUserId: created.ownerUserId, ownerEmail, ownerPassword, roleIds: created.roleIds, cleanup: () => purgeTenant(created.tenantId) };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface Login {
  status: number;
  token: string;
  cookie: string;
  me: any;
  body: any;
}

export async function login(app: Express, email: string, password: string): Promise<Login> {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
  return { status: res.status, token: res.body?.data?.accessToken ?? "", cookie: setCookie?.[0]?.split(";")[0] ?? "", me: res.body?.data?.me, body: res.body };
}

export const loginOwner = (app: Express, fx: Fixture) => login(app, fx.ownerEmail, fx.ownerPassword);

export interface Staff {
  id: string;
  email: string;
  password: string;
  roleId: string;
}

let counter = 0;

/** Create a staff user directly (fast), either with a default role by name or with a custom permission set. */
export async function createStaff(
  fx: Fixture,
  opts: {
    roleName?: string;
    permissions?: PermissionKey[];
    maxDiscountPercent?: number;
    limits?: Record<string, { void?: number; refund?: number; po?: number; adjustment?: number }>;
    allLocations?: boolean;
    locationIds?: string[];
    email?: string;
    pin?: string;
  } = {},
): Promise<Staff> {
  const password = "Staff-Passw0rd-1234";
  const email = opts.email ?? `staff${++counter}-${randomBytes(3).toString("hex")}@${fx.slug}.test`;

  return runAsTenant(fx.tenantId, () =>
    db.$transaction(async (tx) => {
      let roleId = opts.roleName ? fx.roleIds[opts.roleName]! : "";
      if (!roleId) {
        const role = await tx.role.create({
          data: { tenantId: fx.tenantId, name: `custom-${randomBytes(4).toString("hex")}`, maxDiscountPercent: opts.maxDiscountPercent ?? 0 },
        });
        roleId = role.id;
        await tx.rolePermission.createMany({ data: (opts.permissions ?? []).map((permission) => ({ tenantId: fx.tenantId, roleId, permission })) });
        const rows = Object.entries(opts.limits ?? {}).map(([currencyCode, l]) => ({
          tenantId: fx.tenantId, roleId, currencyCode,
          voidLimitMinor: l.void ?? 0, refundLimitMinor: l.refund ?? 0, poApprovalLimitMinor: l.po ?? 0, adjustmentLimitMinor: l.adjustment ?? 0,
        }));
        if (rows.length) await tx.roleLimit.createMany({ data: rows });
      }
      const user = await tx.user.create({
        data: {
          tenantId: fx.tenantId, email, name: `Staff ${counter}`, passwordHash: await hashPassword(password),
          allLocations: opts.allLocations ?? false,
          posPinHash: opts.pin ? await hashPassword(opts.pin) : null,
          roles: { create: [{ roleId }] },
          locations: { create: (opts.locationIds ?? []).map((locationId) => ({ locationId })) },
        },
      });
      return { id: user.id, email, password, roleId };
    }),
  );
}

export const loginStaff = (app: Express, s: Staff) => login(app, s.email, s.password);

export interface BaseOrg {
  brandId: string;
  taxProfileId: string;
  priceBookId: string;
}

/** A brand, a tax profile and a PKR price book: what a branch needs. */
export async function createBaseOrg(fx: Fixture): Promise<BaseOrg> {
  return runAsTenant(fx.tenantId, async () => {
    const brand = await db.brand.create({ data: { tenantId: fx.tenantId, name: "Base Brand", slug: `base-${fx.slug}` } });
    const taxProfile = await db.taxProfile.create({ data: { tenantId: fx.tenantId, name: "No tax", countryCode: "PK", pricesIncludeTax: false } });
    const priceBook = await db.priceBook.create({ data: { tenantId: fx.tenantId, brandId: brand.id, name: "PKR", currencyCode: "PKR" } });
    return { brandId: brand.id, taxProfileId: taxProfile.id, priceBookId: priceBook.id };
  });
}

export async function createLocation(fx: Fixture, base: BaseOrg, code: string, over: Partial<{ type: "BRANCH" | "WAREHOUSE" | "CENTRAL_KITCHEN"; currencyCode: string; name: string }> = {}) {
  return runAsTenant(fx.tenantId, () =>
    db.location.create({
      data: {
        tenantId: fx.tenantId, type: over.type ?? "BRANCH", brandId: over.type && over.type !== "BRANCH" ? null : base.brandId, code,
        name: over.name ?? `Location ${code}`, countryCode: "PK", timezone: "Asia/Karachi", currencyCode: over.currencyCode ?? "PKR",
        taxProfileId: base.taxProfileId, priceBookId: base.priceBookId,
      },
    }),
  );
}
