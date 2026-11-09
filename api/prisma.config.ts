import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer reads the DB url from schema.prisma; the CLI
// (migrate, studio, db push) gets it from here. Runtime queries use the
// pg driver adapter instead (see src/lib/prisma.ts, coming next).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
