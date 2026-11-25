import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { env } from "../config/env.js";
import "./decimal.js"; // decimals serialize as numbers

// Prisma 7 talks to Postgres through the `pg` driver via this adapter.
// The pool settings matter on a hosted database (Neon): it closes idle connections after a while, and a
// pool that still holds one then fails the next query with "Server has closed the connection". Dropping idle
// connections early (and keeping live ones alive) means the pool only ever hands out healthy ones.
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: env.NODE_ENV === "test" ? 6 : 10,
  idleTimeoutMillis: 8_000,
  connectionTimeoutMillis: 20_000,
  keepAlive: true,
});

/**
 * The raw client: NO tenant, soft-delete or location filtering.
 *
 * Importing this is restricted (ESLint `no-restricted-imports`) to the few places that legitimately
 * work before a tenant is known or across tenants: login lookup and session checks (core/auth),
 * the legacy storefront code, seeds, scripts and tests. Everything else uses `db` from ./scoped.
 */
export const unscopedDb = new PrismaClient({
  adapter,
  // Interactive transactions default to 5 s, which a remote database (Neon) can exceed with a few sequential queries.
  // Completing an order is the heaviest one (status, stock for every ingredient, coupons, customer, loyalty, audit):
  // measured at 25 s from a laptop to Neon, over the old 20 s limit, which rolled the whole order back with a 500.
  // 60 s is a ceiling, not a target: a transaction that long still holds row locks, so keep trimming queries too.
  transactionOptions: { timeout: 60_000, maxWait: 15_000 },
});
