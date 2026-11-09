import { luminance, readableOn, type Theme, type ThemeRadius } from "@restoflux/contracts";

// Turns an organization's saved theme (a few hex colours and a roundness) into CSS variables that
// override the defaults in index.css. Components never hard-code colours, so changing the variables
// re-skins buttons, links, focus rings, the active menu item and (optionally) the sidebar.
// Text colours are derived from the chosen background, so a client cannot pick unreadable combinations.

const RADIUS: Record<ThemeRadius, string> = { sharp: "0.25rem", default: "0.625rem", round: "1rem" };
const STYLE_ID = "restoflux-tenant-theme";

/** Blend two #rrggbb colours: t=0 gives a, t=1 gives b. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/** On a dark page a very dark brand colour would vanish, so it is lightened for dark mode only. */
export const primaryForDark = (primary: string): string => (luminance(primary) < 0.18 ? mixHex(primary, "#ffffff", 0.4) : primary);

function primaryVars(p: string): string {
  const on = readableOn(p);
  return [
    `--primary:${p}`, `--primary-foreground:${on}`,
    `--ring:color-mix(in srgb, ${p} 55%, transparent)`,
    `--accent:color-mix(in oklab, ${p} 12%, var(--background))`, `--accent-foreground:var(--foreground)`,
    `--sidebar-primary:${p}`, `--sidebar-primary-foreground:${on}`, `--sidebar-ring:color-mix(in srgb, ${p} 55%, transparent)`,
    `--chart-1:${p}`,
  ].join(";");
}

function sidebarVars(bg: string): string {
  const fg = readableOn(bg);
  return [
    `--sidebar:${bg}`, `--sidebar-foreground:${fg}`, `--sidebar-border:color-mix(in srgb, ${fg} 16%, transparent)`,
    `--sidebar-accent:color-mix(in srgb, ${fg} 12%, ${bg})`, `--sidebar-accent-foreground:${fg}`,
  ].join(";");
}

/** The full stylesheet for a theme. An empty theme gives an empty string (the defaults apply). */
export function buildThemeCss(theme: Theme | null | undefined): string {
  if (!theme) return "";
  const { primary, sidebar, radius } = theme;
  const light: string[] = [];
  const dark: string[] = [];
  if (primary) {
    light.push(primaryVars(primary));
    dark.push(primaryVars(primaryForDark(primary)));
  }
  if (sidebar) {
    // A custom sidebar colour is used in light and dark mode alike; the text colour follows from it.
    light.push(sidebarVars(sidebar));
    dark.push(sidebarVars(sidebar));
  }
  if (radius) light.push(`--radius:${RADIUS[radius]}`);

  const rules: string[] = [];
  if (light.length) rules.push(`:root{${light.join(";")}}`);
  if (dark.length) rules.push(`.dark{${dark.join(";")}}`);
  if (sidebar) {
    const fg = readableOn(sidebar);
    // Labels inside the sidebar use the muted colour; keep it readable on the custom background.
    rules.push(`[data-restoflux-sidebar]{--muted-foreground:color-mix(in srgb, ${fg} 68%, transparent);--foreground:${fg};--muted:color-mix(in srgb, ${fg} 14%, transparent)}`);
  }
  return rules.join("\n");
}

/** Apply (or clear) the theme in the browser. Safe to call repeatedly. */
export function applyTheme(theme: Theme | null | undefined): void {
  if (typeof document === "undefined") return;
  const css = buildThemeCss(theme);
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}
