import { parseArgs } from "node:util";
import { deleteCatalog } from "../src/core/db/purge.js";
import { runAsTenant } from "../src/core/context/context.js";
import { unscopedDb } from "../src/core/db/client.js";
import { db } from "../src/core/db/scoped.js";
import { seedDemoCatalog } from "./seed-catalog.js";

// Adds the demo menu to an EXISTING demo tenant (created before menus existed), keeping its users and
// passwords. Safe to run twice: it does nothing if the demo tenant already has categories.
//   npm run seed:demo-menu              add the menu (does nothing if there already is one)
//   npm run seed:demo-menu -- --reset   delete the demo tenant's menu and add it again (users and passwords are kept)

const { values } = parseArgs({ options: { reset: { type: "boolean", default: false } } });

const tenant = await unscopedDb.tenant.findUnique({ where: { slug: "demo" } });
if (!tenant) {
  console.error("There is no demo tenant. Run: npm run seed:demo");
  process.exit(1);
}

if (values.reset) {
  await unscopedDb.$transaction(async (tx) => deleteCatalog(tx, tenant.id), { timeout: 60_000 });
  console.log("Removed the existing demo menu.");
}

await runAsTenant(tenant.id, async () => {
  if ((await db.category.count()) > 0) {
    console.log("The demo tenant already has a menu. Nothing changed. (npm run seed:demo -- --reset rebuilds everything.)");
    return;
  }
  const [smash, saffron, standard, pkr, aed, usd, locations] = await Promise.all([
    db.brand.findFirstOrThrow({ where: { slug: "smash-co" } }),
    db.brand.findFirstOrThrow({ where: { slug: "saffron-table" } }),
    db.taxCategory.findFirstOrThrow({ where: { name: "Standard" } }),
    db.priceBook.findFirstOrThrow({ where: { currencyCode: "PKR" } }),
    db.priceBook.findFirstOrThrow({ where: { currencyCode: "AED" } }),
    db.priceBook.findFirstOrThrow({ where: { currencyCode: "USD" } }),
    db.location.findMany({ where: { type: "BRANCH" } }),
  ]);
  const loc = (code: string) => locations.find((l) => l.code === code)!.id;
  const result = await seedDemoCatalog({
    tenantId: tenant.id, smashId: smash.id, saffronId: saffron.id, taxCategoryId: standard.id,
    books: { PKR: pkr.id, AED: aed.id, USD: usd.id },
    locations: { khi: loc("KHI-01"), lhe: loc("LHE-01"), dxb: loc("DXB-01"), hou: loc("HOU-01") },
  });
  console.log(`Added the demo menu: ${result.products} products and ${result.combos} combo.`);
});
await unscopedDb.$disconnect();
