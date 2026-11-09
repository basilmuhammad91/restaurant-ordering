import "dotenv/config";
import { z } from "zod";

// Like Laravel's config('app.x') but validated at boot: the app refuses to start with a clear
// error if a required variable is missing or malformed. Values are never printed.
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  /** Legacy (storefront) tokens only; staff access tokens use ACCESS_TOKEN_TTL_SECONDS. */
  JWT_EXPIRES_IN: z.string().default("7d"),
  // Comma-separated browser origins allowed to call the API (CORS): storefront and admin dev servers by default.
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:5174")
    .transform((s) => s.split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean)),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900), // 15 minutes
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(14).default(10),
  /** Send the refresh cookie only over HTTPS. Defaults to true in production. */
  COOKIE_SECURE: bool.optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  COOKIE_SECURE: parsed.data.COOKIE_SECURE ?? parsed.data.NODE_ENV === "production",
};
