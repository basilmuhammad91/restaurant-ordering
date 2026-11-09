import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

// Prisma 7 talks to Postgres through the `pg` driver via this adapter.
// One shared instance for the whole process (like Laravel's DB facade).
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
