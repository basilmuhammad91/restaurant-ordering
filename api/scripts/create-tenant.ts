import { parseArgs } from "node:util";
import { unscopedDb } from "../src/core/db/client.js";
import { createTenant } from "../src/modules/org/provision.js";

// Create a tenant (a customer company) with default roles and an Owner account.
//
//   npm run create-tenant -- --name "Acme Foods" --slug acme --currency PKR \
//        --owner-email owner@acme.com --owner-name "Ayesha Khan" --owner-password '<12+ chars>'
//
// (Laravel: like an artisan command that onboards a new company.)

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    slug: { type: "string" },
    currency: { type: "string", default: "PKR" },
    "owner-email": { type: "string" },
    "owner-name": { type: "string" },
    "owner-password": { type: "string" },
  },
});

const need = ["name", "slug", "owner-email", "owner-name", "owner-password"] as const;
const missing = need.filter((k) => !values[k]);
if (missing.length) {
  console.error(`Missing: ${missing.map((m) => `--${m}`).join(", ")}`);
  console.error("Usage: npm run create-tenant -- --name <name> --slug <slug> [--currency PKR] --owner-email <email> --owner-name <name> --owner-password <12+ chars>");
  process.exit(1);
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.slug!)) {
  console.error("--slug must be lowercase letters, numbers and dashes");
  process.exit(1);
}

try {
  const t = await createTenant({
    name: values.name!,
    slug: values.slug!,
    baseCurrency: values.currency!,
    owner: { name: values["owner-name"]!, email: values["owner-email"]!, password: values["owner-password"]! },
  });
  console.log(`Tenant created: ${values.slug} (id ${t.tenantId}). Owner: ${values["owner-email"]}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await unscopedDb.$disconnect();
}
