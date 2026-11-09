import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { hashPassword } from "../src/core/auth/passwords.js";
import { unscopedDb } from "../src/core/db/client.js";

// Create (or reset the password of) a Restoflux team account for the platform console.
//
//   npm run create-platform-admin -- --email you@restoflux.com --name "Your Name" [--password '<12+ chars>']
//
// Without --password one is generated and printed once. Re-running for an existing email resets its password.
// (Laravel: like `artisan make:admin` for the super-admin guard.)

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, password: { type: "string" } } });
if (!values.email || !values.name) {
  console.error('Usage: npm run create-platform-admin -- --email <email> --name "<name>" [--password <12+ chars>]');
  process.exit(1);
}
if (values.password && values.password.length < 12) {
  console.error("The password must be at least 12 characters.");
  process.exit(1);
}

const email = values.email.toLowerCase();
const password = values.password ?? randomBytes(15).toString("base64url");
const passwordHash = await hashPassword(password);

const existing = await unscopedDb.platformUser.findUnique({ where: { email } });
if (existing) {
  await unscopedDb.platformUser.update({ where: { id: existing.id }, data: { passwordHash, name: values.name, status: "ACTIVE" } });
  await unscopedDb.platformSession.updateMany({ where: { platformUserId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
  console.log(`Updated platform admin ${email} (signed out everywhere).`);
} else {
  await unscopedDb.platformUser.create({ data: { email, name: values.name, passwordHash } });
  console.log(`Created platform admin ${email}.`);
}
if (!values.password) console.log(`Password (shown once): ${password}`);
await unscopedDb.$disconnect();
