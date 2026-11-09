import { BRAND, markSvg } from "@restoflux/contracts";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

// Fills %APP_NAME% and %APP_FAVICON% in index.html from the shared brand definition.
function brandHtml(): Plugin {
  const xml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const favicon = `data:image/svg+xml;base64,${Buffer.from(markSvg(64)).toString("base64")}`; // base64: nothing for Vite to decode
  return {
    name: "brand-html",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => html.replaceAll("%APP_NAME%", `${xml(BRAND.name)} Admin`).replaceAll("%APP_FAVICON%", favicon),
    },
  };
}

// Tailwind v4 ships as a Vite plugin: no tailwind.config.js or postcss needed.
export default defineConfig({
  plugins: [react(), tailwindcss(), brandHtml()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 5174, strictPort: true }, // must match the API's CORS_ORIGINS
});
