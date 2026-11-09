import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { BRAND } from "./src/brand";

// Fills %APP_NAME% and %APP_FAVICON% in index.html from src/brand.ts,
// so the product name lives in exactly one file.
function brandHtml(): Plugin {
  const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#a3141c"/>` +
    `<text x="32" y="41" font-family="Arial,sans-serif" font-size="${BRAND.initials.length > 2 ? 24 : 30}" font-weight="700" fill="white" text-anchor="middle">${xml(BRAND.initials)}</text></svg>`;
  return {
    name: "brand-html",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html
          .replaceAll("%APP_NAME%", xml(BRAND.name))
          .replaceAll("%APP_FAVICON%", `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`), // base64: nothing for Vite to decode
    },
  };
}

// Tailwind v4 ships as a Vite plugin: no tailwind.config.js or postcss needed.
export default defineConfig({
  plugins: [react(), tailwindcss(), brandHtml()],
  server: { port: 5173, strictPort: true }, // must match the API's CORS_ORIGINS
});
