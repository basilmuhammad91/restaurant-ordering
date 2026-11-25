import { parseArgs } from "node:util";
import { runAsTenant } from "../src/core/context/context.js";
import { unscopedDb } from "../src/core/db/client.js";
import { db } from "../src/core/db/scoped.js";

// Puts a relevant photo on every product, category and combo of the DEMO organization.
// Photos are the lead pictures of the matching Wikipedia articles (freely licensed, hosted on Wikimedia), chosen by
// dish name. The file name is kept beside each link so the author can be looked up on commons.wikimedia.org
// ("File:<name>"). They suit a demo; a real restaurant uploads its own photos (planned: Cloudflare R2).
//
//   npm run seed:demo-images -w api                 check every link loads, then fill in images that are still empty
//   npm run seed:demo-images -w api -- --force      also replace images that are already set
//   npm run seed:demo-images -w api -- --check      only check the links, change nothing
//   npm run seed:demo-images -w api -- --clear      remove the images this script set (matches by link)

const { values } = parseArgs({ options: { force: { type: "boolean", default: false }, check: { type: "boolean", default: false }, clear: { type: "boolean", default: false } } });

const thumb = (hash: string, file: string) => `https://thumb.wikimedia.org/wikipedia/commons/thumb/${hash}/${file}/960px-${file}`;
const orig = (hash: string, file: string) => `https://upload.wikimedia.org/wikipedia/commons/${hash}/${file}`;

// file name -> link
const FILE = {
  tikka: orig("b/bd", "Tandoorimumbai.jpg"),
  seekh: thumb("0/0c", "Pakistani_Food_Beef_Kabobs.jpg"),
  boti: thumb("5/50", "%C5%9Ei%C5%9F_kebap_and_pilav.jpg"),
  karahi: thumb("b/be", "Punjabi_Chicken_Karahi.JPG"),
  muttonKarahi: thumb("6/67", "Rogan_Josh_Kashmiri.jpg"),
  biryani: thumb("b/bd", "Sindhi_Biryani.JPG"),
  naan: thumb("4/4e", "Annapurna_Naan.jpg"),
  lassi: thumb("f/f1", "Salt_lassi.jpg"),
  gulab: orig("c/c1", "Gulab-jamun-wallpaper-1.jpg"),
  kheer: thumb("4/46", "Kheer.jpg"),
  mojito: thumb("5/54", "15-09-26-RalfR-WLC-0072.jpg"),
  cheeseburger: thumb("4/4d", "Cheeseburger.jpg"),
  burger: thumb("0/0b", "RedDot_Burger.jpg"),
  veggie: thumb("e/e0", "%D7%94%D7%9E%D7%91%D7%95%D7%A8%D7%92%D7%A8_%D7%98%D7%91%D7%A2%D7%95%D7%A0%D7%99.jpg"),
  friedChicken: thumb("2/2c", "Fried-Chicken-Set.jpg"),
  fries: orig("8/83", "French_Fries.JPG"),
  onionRings: thumb("e/eb", "OnionRings.JPG"),
  coleslaw: thumb("2/29", "2015-12-20_Spitzkohlsalat_mit_M%C3%B6hren_anagoria.JPG"),
  cola: thumb("2/23", "Glass_of_Cola.jpg"),
  lemonade: thumb("1/10", "Lemonade_-_27682817724.jpg"),
  milkshake: thumb("6/68", "Strawberry_milk_shake_%28cropped%29.jpg"),
  brownie: thumb("6/68", "Chocolatebrownie.JPG"),
  bbq: thumb("0/00", "Barbecued_meats.jpg"),
  fastFood: thumb("b/b0", "Hamburger_%2812164386105%29.jpg"),
  desserts: thumb("a/ab", "Desserts.jpg"),
  softDrink: orig("c/cf", "Tumbler_of_cola_with_ice.jpg"),
  wokKarahi: thumb("7/70", "Wok-and-karahi-2.jpg"),
  palo: orig("d/dd", "Afghan_Palo.jpg"),
  burfi: thumb("f/f1", "Almond_Khoa_based_burfi_Mumbai_India_%28cropped%29.jpg"),
  combo: orig("1/16", "In-N-Out_Burger_hamburger%2C_fries_and_soda.jpg"),
} as const;

// product name -> photo
const PRODUCTS: Record<string, string> = {
  "Chicken Tikka": FILE.tikka, "Seekh Kebab": FILE.seekh, "Beef Boti": FILE.boti,
  "Chicken Karahi": FILE.karahi, "Mutton Karahi": FILE.muttonKarahi, "Chicken Biryani": FILE.biryani,
  "Plain Naan": FILE.naan, "Roghni Naan": FILE.naan,
  Lassi: FILE.lassi, "Mint Margarita": FILE.mojito, "Gulab Jamun": FILE.gulab, Kheer: FILE.kheer,
  "Classic Smash": FILE.burger, "Cheese Smash": FILE.cheeseburger, "Garden Veggie": FILE.veggie, "Spicy Chicken Crunch": FILE.friedChicken,
  Fries: FILE.fries, "Onion Rings": FILE.onionRings, Coleslaw: FILE.coleslaw,
  Cola: FILE.cola, "Fresh Lemonade": FILE.lemonade, Milkshake: FILE.milkshake, "Fudge Brownie": FILE.brownie,
};
// "<brand>/<category>" -> photo
const CATEGORIES: Record<string, string> = {
  "Saffron Table/BBQ & Grill": FILE.bbq, "Saffron Table/Karahi": FILE.wokKarahi, "Saffron Table/Rice & Bread": FILE.palo,
  "Saffron Table/Drinks": FILE.lassi, "Saffron Table/Sweets": FILE.burfi,
  "Smash & Co/Burgers": FILE.fastFood, "Smash & Co/Sides": FILE.fries, "Smash & Co/Drinks": FILE.softDrink, "Smash & Co/Desserts": FILE.desserts,
};
const COMBOS: Record<string, string> = { "Smash & Co/Smash Meal": FILE.combo };

const allLinks = [...new Set([...Object.values(PRODUCTS), ...Object.values(CATEGORIES), ...Object.values(COMBOS)])];

// 1) every link must answer 200 with an image, or nothing is written
const bad: string[] = [];
for (const url of allLinks) {
  try {
    const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": "restoflux-demo-images/1.0 (portfolio project)" }, redirect: "follow" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) bad.push(`${res.status} ${type || "no type"}  ${url}`);
  } catch (e) {
    bad.push(`unreachable  ${url}  (${(e as Error).message})`);
  }
}
console.log(`Checked ${allLinks.length} photo links: ${allLinks.length - bad.length} load, ${bad.length} do not.`);
if (bad.length) { console.error(bad.join("\n")); if (!values.clear) process.exit(1); }
if (values.check) process.exit(0);

// 2) write them
const tenant = await unscopedDb.tenant.findUnique({ where: { slug: "demo" } });
if (!tenant) { console.error("There is no demo tenant. Run: npm run seed:demo"); process.exit(1); }

await runAsTenant(tenant.id, async () => {
  const set = (current: string | null, next: string) => (values.clear ? (allLinks.includes(current ?? "") ? null : current) : current && !values.force ? current : next);
  let changed = 0;
  const products = await db.product.findMany({ select: { id: true, name: true, imageUrl: true } });
  for (const p of products) {
    const photo = PRODUCTS[p.name];
    if (!photo) continue;
    const next = set(p.imageUrl, photo);
    if (next !== p.imageUrl) { await db.product.update({ where: { id: p.id }, data: { imageUrl: next } }); changed++; }
  }
  const categories = await db.category.findMany({ select: { id: true, name: true, imageUrl: true, brand: { select: { name: true } } } });
  for (const c of categories) {
    const photo = CATEGORIES[`${c.brand.name}/${c.name}`];
    if (!photo) continue;
    const next = set(c.imageUrl, photo);
    if (next !== c.imageUrl) { await db.category.update({ where: { id: c.id }, data: { imageUrl: next } }); changed++; }
  }
  const combos = await db.combo.findMany({ select: { id: true, name: true, imageUrl: true, brand: { select: { name: true } } } });
  for (const c of combos) {
    const photo = COMBOS[`${c.brand.name}/${c.name}`];
    if (!photo) continue;
    const next = set(c.imageUrl, photo);
    if (next !== c.imageUrl) { await db.combo.update({ where: { id: c.id }, data: { imageUrl: next } }); changed++; }
  }
  console.log(values.clear ? `Removed ${changed} images.` : `Set ${changed} images (products, categories and combos).`);
});
await unscopedDb.$disconnect();
