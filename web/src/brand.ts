// The ONE place to rename or restyle the product. Used by the header, footer, admin bar,
// page title and favicon (index.html and the favicon are filled from this file by vite.config.ts).
export const BRAND = {
  name: "Restoflux",
  lead: "Resto", // wordmark is "Resto" + "flux", with the second part in the accent colour
  accent: "flux",
  tagline: "Order smarter. Serve faster.",
  color: "#a3141c", // deep red, same value as --color-brand in index.css
} as const;

// The logo mark: a serving cloche (dome) over a plate, with a flowing wave beneath.
// Plain SVG markup so it can be inlined in React, used as the favicon, and saved as a file.
export function markSvg(size = 32): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" role="img" aria-label="${BRAND.name} logo">` +
    `<defs><linearGradient id="rf-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4222c"/><stop offset="1" stop-color="#8a0f17"/></linearGradient></defs>` +
    `<rect width="48" height="48" rx="12" fill="url(#rf-g)"/>` +
    `<path d="M10.5 29.5a13.5 13.5 0 0 1 27 0z" fill="#fff"/>` + // cloche dome
    `<circle cx="24" cy="14.4" r="2.2" fill="#fff"/>` + // knob
    `<rect x="7.5" y="31.6" width="33" height="2.6" rx="1.3" fill="#fff"/>` + // plate
    `<path d="M8 39.6q4-4.6 8 0t8 0 8 0 8 0" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="2.4" stroke-linecap="round"/>` + // flow
    `</svg>`
  );
}
