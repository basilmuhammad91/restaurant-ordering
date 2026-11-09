import { z } from "zod";
import { hexColorSchema } from "./schemas/common.js";

// Per-organization look of the admin UI. Stored on the tenant (Tenant.theme) and applied in the
// browser as CSS variables, so a client's staff see their own button colour and sidebar. Only a few
// deliberate knobs are exposed: free-form CSS would let one client break their own screens.
// Text colours are never chosen by the client; they are derived (see readableOn) so contrast is always safe.

export const THEME_RADII = ["sharp", "default", "round"] as const;
export type ThemeRadius = (typeof THEME_RADII)[number];

export const themeSchema = z.object({
  /** Buttons, links, focus rings, the active menu item. */
  primary: hexColorSchema.optional(),
  /** Sidebar background. Leave empty to follow light / dark mode. */
  sidebar: hexColorSchema.optional(),
  /** Corner roundness of buttons, inputs and cards. */
  radius: z.enum(THEME_RADII).optional(),
});
export type Theme = z.infer<typeof themeSchema>;

/** The default Restoflux look (used when a tenant has not customised anything). */
export const DEFAULT_THEME_PRIMARY = "#b01e28";

export const THEME_PRESETS: { name: string; theme: Theme }[] = [
  { name: "Restoflux red", theme: { primary: "#b01e28", radius: "default" } },
  { name: "Ocean blue", theme: { primary: "#1d4ed8", radius: "default" } },
  { name: "Forest green", theme: { primary: "#15803d", radius: "default" } },
  { name: "Saffron orange", theme: { primary: "#c2410c", radius: "round" } },
  { name: "Royal purple", theme: { primary: "#7e22ce", radius: "default" } },
  { name: "Slate", theme: { primary: "#334155", sidebar: "#0f172a", radius: "sharp" } },
];

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of a #rrggbb colour (0 black .. 1 white). */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two colours (1 .. 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black, whichever reads better on the given background. Always at least ~4.5:1. */
export function readableOn(background: string): "#ffffff" | "#111111" {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#111111") ? "#ffffff" : "#111111";
}
