import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests talk to a remote database (Neon) and run in parallel, so allow for network latency.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
