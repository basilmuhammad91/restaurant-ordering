import bcrypt from "bcrypt";
import { prisma } from "../src/lib/prisma.js";

// Usage: npm run create-admin -- you@example.com "Your Name" 'a-strong-password'
// Like `php artisan tinker` / a seeder: the only way to get an ADMIN, since the
// API never lets clients choose their role.
const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password || password.length < 8) {
  console.error("Usage: npm run create-admin -- <email> <name> <password (min 8 chars)>");
  process.exit(1);
}

const passwordHash = await bcrypt.hash(password, 10);
const user = await prisma.user.upsert({
  where: { email: email.toLowerCase() },
  update: { role: "ADMIN", passwordHash, name },
  create: { email: email.toLowerCase(), name, passwordHash, role: "ADMIN" },
});
console.log(`Admin ready: ${user.email} (id ${user.id})`);
await prisma.$disconnect();
