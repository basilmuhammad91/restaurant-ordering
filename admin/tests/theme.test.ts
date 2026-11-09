import { contrastRatio, readableOn } from "@restoflux/contracts";
import { describe, expect, it } from "vitest";
import { buildThemeCss, mixHex, primaryForDark } from "../src/lib/theme";

describe("theme CSS", () => {
  it("an empty or missing theme changes nothing", () => {
    expect(buildThemeCss({})).toBe("");
    expect(buildThemeCss(null)).toBe("");
    expect(buildThemeCss(undefined)).toBe("");
  });

  it("a brand colour sets the primary variables with a readable foreground in light and dark mode", () => {
    const css = buildThemeCss({ primary: "#1d4ed8" });
    expect(css).toContain(":root{");
    expect(css).toContain(".dark{");
    expect(css).toContain("--primary:#1d4ed8");
    expect(css).toContain(`--primary-foreground:${readableOn("#1d4ed8")}`);
    expect(css).not.toContain("--sidebar:"); // sidebar untouched
    expect(css).not.toContain("--radius");
  });

  it("a very dark brand colour is lightened for dark mode only, so buttons stay visible", () => {
    const css = buildThemeCss({ primary: "#0f172a" });
    const [light, dark] = css.split("\n") as [string, string];
    expect(light).toContain("--primary:#0f172a");
    expect(dark).not.toContain("--primary:#0f172a");
    expect(primaryForDark("#0f172a")).not.toBe("#0f172a");
    expect(primaryForDark("#f97316")).toBe("#f97316"); // already bright enough
  });

  it("a custom sidebar gets its own readable text and muted colours", () => {
    const css = buildThemeCss({ sidebar: "#0f172a" });
    expect(css).toContain("--sidebar:#0f172a");
    expect(css).toContain("--sidebar-foreground:#ffffff");
    expect(css).toContain("[data-restoflux-sidebar]");
    const light = buildThemeCss({ sidebar: "#fef3c7" });
    expect(light).toContain("--sidebar-foreground:#111111");
  });

  it("corner roundness maps to a radius", () => {
    expect(buildThemeCss({ radius: "sharp" })).toContain("--radius:0.25rem");
    expect(buildThemeCss({ radius: "round" })).toContain("--radius:1rem");
    expect(buildThemeCss({ radius: "default" })).toContain("--radius:0.625rem");
  });

  it("never emits anything but known variables, whatever the input colour is", () => {
    const css = buildThemeCss({ primary: "#ABCDEF", sidebar: "#123456", radius: "round" });
    expect(css).not.toMatch(/url\(|expression|javascript:|</i);
    expect(css).toMatch(/^:root\{[^}]*\}\n\.dark\{[^}]*\}\n\[data-restoflux-sidebar\]\{[^}]*\}$/);
  });

  it("mixes colours", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#112233", "#112233", 0.7)).toBe("#112233");
  });

  it("derived text is readable on every preset colour", () => {
    for (const bg of ["#b01e28", "#1d4ed8", "#15803d", "#c2410c", "#7e22ce", "#334155", "#0f172a", "#fef3c7"]) {
      expect(contrastRatio(bg, readableOn(bg)), bg).toBeGreaterThanOrEqual(4.5);
    }
  });
});
