import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tailwind v4 ships as a Vite plugin: no tailwind.config.js or postcss needed.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true }, // must match the API's CORS_ORIGINS
});
