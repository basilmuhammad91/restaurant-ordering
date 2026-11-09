import "dotenv/config";
import { z } from "zod";

// Like Laravel's config('app.x') but validated at boot: the app refuses to
// start with a clear error if a required variable is missing or malformed.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  // Comma-separated list of browser origins allowed to call the API (CORS).
  // Locally this is Vite's dev server; add your Vercel URL when you deploy.
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean)),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
