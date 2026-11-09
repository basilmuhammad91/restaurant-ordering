import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the framework-free parts of the admin app (navigation rules, money maths, date presets).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
