import { unscopedDb } from "../src/core/db/client.js";
import { purgeTenant } from "../src/core/db/purge.js";

// Removes tenants leaked by interrupted test runs. Test fixtures create tenants whose slug looks like
// "t<random>" and whose name starts with "Test ". Real tenants (default, demo, customers) never match.
//   npm run test:cleanup
const leaked = await unscopedDb.tenant.findMany({
  where: { name: { startsWith: "Test " }, slug: { startsWith: "t" } },
  select: { id: true, slug: true },
});
const matching = leaked.filter((t) => /^t[0-9a-z]{9,}$/.test(t.slug));
for (const t of matching) {
  await purgeTenant(t.id);
  console.log(`Removed leaked test tenant ${t.slug}`);
}
console.log(matching.length ? `Done: ${matching.length} removed.` : "No leaked test tenants.");
await unscopedDb.$disconnect();
