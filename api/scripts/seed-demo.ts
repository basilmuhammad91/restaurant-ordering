import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/core/auth/passwords.js";
import { seedDemoCatalog } from "./seed-catalog.js";
import { runAsTenant } from "../src/core/context/context.js";
import { unscopedDb } from "../src/core/db/client.js";
import { db } from "../src/core/db/scoped.js";
import { purgeTenant } from "../src/core/db/purge.js";
import { createTenant } from "../src/modules/org/provision.js";

// DEMO TENANT (Phase 1 portion; later phases extend it with menus, stock and orders).
//   npm run seed:demo               create it if missing (safe to run twice: nothing changes the second time)
//   npm run seed:demo -- --reset    delete the demo tenant and recreate it (new passwords)
//
// Demo passwords are random per run and printed ONCE below: they are not stored anywhere in source.
// Tax rates are ILLUSTRATIVE demo values, not tax advice: verify real rates before any real use.

const { values } = parseArgs({ options: { reset: { type: "boolean", default: false } } });
const SLUG = "demo";

const existing = await unscopedDb.tenant.findUnique({ where: { slug: SLUG } });
if (existing && !values.reset) {
  console.log(`Demo tenant already exists (id ${existing.id}). Nothing changed. Use --reset to recreate it and get new passwords.`);
  await unscopedDb.$disconnect();
  process.exit(0);
}
if (existing) {
  await purgeTenant(existing.id);
  console.log("Existing demo tenant removed.");
}

const pw = () => randomBytes(12).toString("base64url"); // 16 chars
const ownerPassword = pw();
const created = await createTenant({
  name: "Restoflux Demo Group",
  slug: SLUG,
  baseCurrency: "PKR",
  owner: { name: "Demo Owner", email: "owner@demo.restoflux.test", password: ownerPassword },
});
const credentials: { role: string; email: string; password: string }[] = [{ role: "Owner", email: "owner@demo.restoflux.test", password: ownerPassword }];

await runAsTenant(created.tenantId, async () => {
  const tenantId = created.tenantId;

  // ---- brands ----
  const smash = await db.brand.create({ data: { tenantId, name: "Smash & Co", slug: "smash-co", cuisine: "Burgers", primaryColor: "#c2410c" } });
  const saffron = await db.brand.create({ data: { tenantId, name: "Saffron Table", slug: "saffron-table", cuisine: "Pakistani grill", primaryColor: "#a16207" } });

  // ---- taxes (illustrative demo rates) ----
  const standard = await db.taxCategory.create({ data: { tenantId, name: "Standard" } });
  const mkProfile = async (name: string, countryCode: string, pricesIncludeTax: boolean, rules: { name: string; authorityCode: string; ratePercent: number }[]) => {
    const profile = await db.taxProfile.create({ data: { tenantId, name, countryCode, pricesIncludeTax } });
    await db.taxRule.createMany({ data: rules.map((r, i) => ({ tenantId, taxProfileId: profile.id, taxCategoryId: standard.id, sortOrder: i, ...r })) });
    return profile;
  };
  const sindh = await mkProfile("Pakistan: Sindh (demo rate)", "PK", false, [{ name: "SRB sales tax", authorityCode: "SRB", ratePercent: 13 }]);
  const punjab = await mkProfile("Pakistan: Punjab (demo rate)", "PK", false, [{ name: "PRA sales tax", authorityCode: "PRA", ratePercent: 16 }]);
  const uae = await mkProfile("UAE VAT (demo rate)", "AE", true, [{ name: "VAT", authorityCode: "FTA", ratePercent: 5 }]);
  const texas = await mkProfile("USA: Texas sales tax (demo rate)", "US", false, [{ name: "Sales tax", authorityCode: "TX", ratePercent: 8.25 }]);

  // ---- price books (one per currency) ----
  const pkrBook = await db.priceBook.create({ data: { tenantId, name: "Pakistan PKR", currencyCode: "PKR", isDefault: true } });
  const aedBook = await db.priceBook.create({ data: { tenantId, name: "UAE AED", currencyCode: "AED" } });
  const usdBook = await db.priceBook.create({ data: { tenantId, name: "USA USD", currencyCode: "USD" } });

  // ---- locations ----
  const mk = (code: string, name: string, brandId: string | null, type: "BRANCH" | "CENTRAL_KITCHEN", country: string, city: string, timezone: string, currency: string, taxProfileId: string, priceBookId: string, prefix: string) =>
    db.location.create({
      data: { tenantId, type, brandId, code, name, countryCode: country, city, timezone, currencyCode: currency, taxProfileId, priceBookId, orderPrefix: prefix, acceptsOnlineOrders: type === "BRANCH", receiptFooter: "Thank you for dining with us!" },
    });
  const khi = await mk("KHI-01", "Smash & Co: Clifton", smash.id, "BRANCH", "PK", "Karachi", "Asia/Karachi", "PKR", sindh.id, pkrBook.id, "KH");
  const lhe = await mk("LHE-01", "Saffron Table: Gulberg", saffron.id, "BRANCH", "PK", "Lahore", "Asia/Karachi", "PKR", punjab.id, pkrBook.id, "LH");
  const dxb = await mk("DXB-01", "Smash & Co: Marina", smash.id, "BRANCH", "AE", "Dubai", "Asia/Dubai", "AED", uae.id, aedBook.id, "DX");
  const hou = await mk("HOU-01", "Saffron Table: Westheimer", saffron.id, "BRANCH", "US", "Houston", "America/Chicago", "USD", texas.id, usdBook.id, "HO");
  const ck = await mk("KHI-CK", "Karachi Central Kitchen", null, "CENTRAL_KITCHEN", "PK", "Karachi", "Asia/Karachi", "PKR", sindh.id, pkrBook.id, "CK");

  // opening hours: every day 11:00 - 02:00 (closes after midnight) at the branches
  for (const loc of [khi, lhe, dxb, hou]) {
    await db.locationOpeningHour.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ tenantId, locationId: loc.id, weekday, opensAt: "11:00", closesAt: "02:00" })) });
    await db.diningTable.createMany({ data: Array.from({ length: 8 }, (_, i) => ({ tenantId, locationId: loc.id, name: `T${i + 1}`, seats: i < 4 ? 2 : 4, section: i < 4 ? "Window" : "Main hall" })) });
    await db.kitchenStation.createMany({ data: [["GRILL", "Grill"], ["FRY", "Fryer"], ["BAR", "Drinks bar"]].map(([key, name], i) => ({ tenantId, locationId: loc.id, key: key!, name: name!, sortOrder: i })) });
  }

  // payment methods per branch (wallets only in Pakistan, as an example of branch-level configuration)
  const methods = await db.paymentMethod.findMany();
  const byName = new Map(methods.map((m) => [m.name, m]));
  const wallets = await db.paymentMethod.createMany({
    data: [
      { tenantId, name: "JazzCash", type: "WALLET", providerCode: "JAZZCASH", requiresReference: true },
      { tenantId, name: "Easypaisa", type: "WALLET", providerCode: "EASYPAISA", requiresReference: true },
    ],
  });
  void wallets;
  const allMethods = await db.paymentMethod.findMany();
  const isPk = (loc: { countryCode: string }) => loc.countryCode === "PK";
  for (const loc of [khi, lhe, dxb, hou]) {
    const usable = allMethods.filter((m) => (m.providerCode ? isPk(loc) : m.name !== "Mobile wallet" || isPk(loc)));
    await db.locationPaymentMethod.createMany({ data: usable.map((m, i) => ({ tenantId, locationId: loc.id, paymentMethodId: m.id, sortOrder: i })) });
  }
  void byName;

  // ---- the menu: categories, sizes, add-ons, combos, dayparts, prices, 86 ----
  const menu = await seedDemoCatalog({
    tenantId, smashId: smash.id, saffronId: saffron.id, taxCategoryId: standard.id,
    books: { PKR: pkrBook.id, AED: aedBook.id, USD: usdBook.id },
    locations: { khi: khi.id, lhe: lhe.id, dxb: dxb.id, hou: hou.id },
  });
  console.log(`Demo menu: ${menu.products} products, ${menu.combos} combo.`);

  // ---- one user per default role ----
  const roles = await db.role.findMany();
  const roleId = (name: string) => roles.find((r) => r.name === name)!.id;
  const people: { role: string; email: string; name: string; allLocations?: boolean; locations?: string[] }[] = [
    { role: "Head Office Admin", email: "ho.admin@demo.restoflux.test", name: "Hira Admin", allLocations: true },
    { role: "Area Manager", email: "area.manager@demo.restoflux.test", name: "Areeb Manager", locations: [khi.id, lhe.id] },
    { role: "Branch Manager", email: "branch.manager@demo.restoflux.test", name: "Bilal Manager", locations: [khi.id] },
    { role: "Cashier", email: "cashier@demo.restoflux.test", name: "Sana Cashier", locations: [khi.id] },
    { role: "Kitchen Staff", email: "kitchen@demo.restoflux.test", name: "Kamran Kitchen", locations: [khi.id] },
    { role: "Inventory Clerk", email: "inventory@demo.restoflux.test", name: "Imran Stock", locations: [khi.id, ck.id] },
    { role: "Rider", email: "rider@demo.restoflux.test", name: "Rashid Rider", locations: [khi.id] },
  ];
  for (const p of people) {
    const password = pw();
    await db.user.create({
      data: {
        tenantId, email: p.email, name: p.name, passwordHash: await hashPassword(password), allLocations: p.allLocations ?? false,
        roles: { create: [{ roleId: roleId(p.role) }] },
        locations: { create: (p.locations ?? []).map((locationId) => ({ locationId })) },
      },
    });
    credentials.push({ role: p.role, email: p.email, password });
  }

  // POS PIN for the branch manager and area manager, so inline overrides can be tried (PIN printed below)
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  for (const email of ["branch.manager@demo.restoflux.test", "area.manager@demo.restoflux.test"]) {
    await db.user.update({ where: { email }, data: { posPinHash: await hashPassword(pin) } });
  }
  credentials.push({ role: "(POS PIN for both managers)", email: "-", password: pin });
});

console.log("\nDemo tenant created. Log in at the admin app with any of these (shown once):\n");
for (const c of credentials) console.log(`  ${c.role.padEnd(30)} ${c.email.padEnd(36)} ${c.password}`);
console.log("");
await unscopedDb.$disconnect();
