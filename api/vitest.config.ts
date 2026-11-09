import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests talk to a remote database (Neon) and run in parallel, so allow for network latency.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Each test file creates its own tenant, so files can run in parallel safely; cap the workers to
    // keep memory and database load reasonable.
    maxWorkers: 3,
    // Fast password hashing in tests (production default is 10 rounds).
    env: { BCRYPT_ROUNDS: "4" },
  },
});
