import { OWNER_ROLE_NAME } from "@restoflux/contracts";
import { randomBytes } from "node:crypto";
import { runAsTenant } from "../src/core/context/context.js";
import { unscopedDb } from "../src/core/db/client.js";
import { db } from "../src/core/db/scoped.js";
import { createTenant, seedCurrencies } from "../src/modules/org/provision.js";

// PHASE 1 DATA MIGRATION (docs/DATA_MODEL.md section 6.4). Idempotent: safe to run repeatedly.
//
// Creates the "default" tenant that stands in for the original single restaurant:
//   brand "Default", branch "Main Branch" (PKR, Asia/Karachi), a zero-rate tax profile, a PKR price book,
//   default roles, payment methods and reason codes.
// Then copies every legacy ADMIN into a staff User with the Owner role, KEEPING the same email and
// password hash, so existing admins log into the new admin app with the password they already use.
// Legacy customers stay in the legacy table until Phase 3.
// Nothing legacy is changed or deleted.

await seedCurrencies();

let tenant = await unscopedDb.tenant.findUnique({ where: { slug: "default" } });
if (!tenant) {
  // The owner here is a placeholder with an unguessable password; real owners are copied from legacy admins below.
  const created = await createTenant({
    name: "Default Company",
    slug: "default",
    baseCurrency: "PKR",
    owner: { name: "Default Owner (placeholder)", email: "default-owner@restoflux.invalid", password: randomBytes(24).toString("base64url") },
  });
  tenant = await unscopedDb.tenant.findUniqueOrThrow({ where: { id: created.tenantId } });
  console.log("Default tenant created.");
} else {
  console.log("Default tenant already exists.");
}

await runAsTenant(tenant.id, async () => {
  // Master data (only if missing)
  const brand =
    (await db.brand.findFirst({ where: { slug: "default" } })) ??
    (await db.brand.create({ data: { tenantId: tenant.id, name: "Default", slug: "default" } }));
  const taxProfile =
    (await db.taxProfile.findFirst({ where: { name: "No tax" } })) ??
    (await db.taxProfile.create({ data: { tenantId: tenant.id, name: "No tax", countryCode: "PK", pricesIncludeTax: false } }));
  const priceBook =
    (await db.priceBook.findFirst({ where: { name: "Default PKR" } })) ??
    (await db.priceBook.create({ data: { tenantId: tenant.id, brandId: brand.id, name: "Default PKR", currencyCode: "PKR", isDefault: true } }));
  let location = await db.location.findFirst({ where: { code: "MAIN" } });
  if (!location) {
    location = await db.location.create({
      data: {
        tenantId: tenant.id, type: "BRANCH", brandId: brand.id, code: "MAIN", name: "Main Branch", countryCode: "PK", timezone: "Asia/Karachi",
        currencyCode: "PKR", taxProfileId: taxProfile.id, priceBookId: priceBook.id, acceptsOnlineOrders: true,
      },
    });
    const methods = await db.paymentMethod.findMany();
    await db.locationPaymentMethod.createMany({ data: methods.map((m, i) => ({ tenantId: tenant.id, locationId: location!.id, paymentMethodId: m.id, sortOrder: i })) });
    console.log("Main Branch created.");
  }

  // Legacy admins -> staff owners (same email + password hash)
  const owner = await db.role.findFirstOrThrow({ where: { name: OWNER_ROLE_NAME } });
  const legacyAdmins = await unscopedDb.legacyUser.findMany({ where: { role: "ADMIN" } });
  let copied = 0;
  for (const admin of legacyAdmins) {
    const email = admin.email.toLowerCase();
    if (await unscopedDb.user.findUnique({ where: { email } })) continue;
    await db.user.create({
      data: {
        tenantId: tenant.id, email, name: admin.name, passwordHash: admin.passwordHash, allLocations: true,
        roles: { create: [{ roleId: owner.id }] },
      },
    });
    copied++;
  }
  console.log(`Legacy admins found: ${legacyAdmins.length}, copied as Owners: ${copied}.`);
});

// The placeholder owner is only a bootstrap artefact: remove it once a real owner exists.
const real = await unscopedDb.user.count({ where: { tenantId: tenant.id, email: { not: "default-owner@restoflux.invalid" } } });
if (real > 0) {
  const placeholder = await unscopedDb.user.findUnique({ where: { email: "default-owner@restoflux.invalid" } });
  if (placeholder) {
    await unscopedDb.user.delete({ where: { id: placeholder.id } });
    console.log("Placeholder owner removed.");
  }
} else {
  console.log("No legacy admins found: run `npm run create-tenant` or create an admin, then re-run this script.");
}
await unscopedDb.$disconnect();
