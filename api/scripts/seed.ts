import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import type { OrderChannel, OrderStatus } from "../src/generated/prisma/client.js";
import { prisma } from "../src/legacy/prisma.js";

// Idempotent seeder (safe to run repeatedly):
//   npm run db:seed                      -> menu + deals + demo orders (demo orders only if none exist yet)
//   npm run db:seed -- --refresh-demo    -> also delete and regenerate the demo orders relative to today
// Prices are PKR in paisa (integer minor units): 125000 = Rs. 1,250.

const rs = (rupees: number) => rupees * 100;

// legacyPriceCents: the old USD-scale price of the first seed. Items still at that exact price
// are upgraded to PKR once; anything you have edited yourself is never touched.
const menu: Record<string, Array<{ name: string; description: string; priceCents: number; legacyPriceCents: number }>> = {
  Starters: [
    { name: "Bruschetta", description: "Grilled bread, tomato, basil, garlic, olive oil", priceCents: rs(650), legacyPriceCents: 750 },
    { name: "Garlic Prawns", description: "Pan-fried prawns in garlic butter", priceCents: rs(1450), legacyPriceCents: 1150 },
    { name: "Tomato Soup", description: "Roasted tomato soup with fresh cream", priceCents: rs(550), legacyPriceCents: 650 },
  ],
  Mains: [
    { name: "Margherita Pizza", description: "Tomato, mozzarella, fresh basil", priceCents: rs(1250), legacyPriceCents: 1300 },
    { name: "Spaghetti Carbonara", description: "Pancetta, egg, pecorino, black pepper", priceCents: rs(1390), legacyPriceCents: 1450 },
    { name: "Grilled Salmon", description: "Lemon herb salmon with seasonal vegetables", priceCents: rs(2250), legacyPriceCents: 1850 },
  ],
  Desserts: [
    { name: "Tiramisu", description: "Espresso-soaked sponge with mascarpone", priceCents: rs(790), legacyPriceCents: 800 },
    { name: "Chocolate Lava Cake", description: "Warm chocolate cake with a molten centre", priceCents: rs(850), legacyPriceCents: 850 },
  ],
  Drinks: [
    { name: "Fresh Lemonade", description: "House-squeezed lemons, mint", priceCents: rs(350), legacyPriceCents: 400 },
    { name: "Espresso", description: "Double shot", priceCents: rs(300), legacyPriceCents: 350 },
  ],
};

const deals = [
  { name: "Pizza & Sip", description: "A Margherita pizza with a fresh lemonade", dealRs: 1290, parts: { "Margherita Pizza": 1, "Fresh Lemonade": 1 } },
  { name: "Coffee & Cake", description: "Two espressos and a warm lava cake", dealRs: 1090, parts: { Espresso: 2, "Chocolate Lava Cake": 1 } },
  { name: "Date Night", description: "Prawns, salmon, carbonara and two tiramisu", dealRs: 5490, parts: { "Garlic Prawns": 1, "Grilled Salmon": 1, "Spaghetti Carbonara": 1, Tiramisu: 2 } },
  { name: "Family Feast", description: "Two pizzas, a pasta, bruschetta and lemonade for everyone", dealRs: 4990, parts: { "Margherita Pizza": 2, "Spaghetti Carbonara": 1, Bruschetta: 2, "Fresh Lemonade": 3 } },
];

async function seedMenu() {
  let created = 0;
  let repriced = 0;
  for (const [categoryName, items] of Object.entries(menu)) {
    const category = await prisma.legacyCategory.upsert({ where: { name: categoryName }, update: {}, create: { name: categoryName } });
    for (const { legacyPriceCents, ...item } of items) {
      const existing = await prisma.legacyMenuItem.findFirst({ where: { name: item.name, categoryId: category.id } });
      if (!existing) {
        await prisma.legacyMenuItem.create({ data: { ...item, categoryId: category.id } });
        created++;
      } else if (existing.priceCents === legacyPriceCents && existing.priceCents !== item.priceCents) {
        await prisma.legacyMenuItem.update({ where: { id: existing.id }, data: { priceCents: item.priceCents } });
        repriced++;
      }
    }
  }
  console.log(`Menu: ${created} created, ${repriced} converted to PKR prices.`);
}

async function seedDeals() {
  const byName = new Map((await prisma.legacyMenuItem.findMany()).map((m) => [m.name, m]));
  let created = 0;
  for (const d of deals) {
    if (await prisma.legacyDeal.findFirst({ where: { name: d.name } })) continue;
    const parts = Object.entries(d.parts).map(([name, quantity]) => ({ menuItemId: byName.get(name)!.id, quantity }));
    const originalPriceCents = Object.entries(d.parts).reduce((sum, [name, qty]) => sum + qty * byName.get(name)!.priceCents, 0);
    await prisma.legacyDeal.create({
      data: { name: d.name, description: d.description, dealPriceCents: rs(d.dealRs), originalPriceCents, items: { create: parts } },
    });
    created++;
  }
  console.log(`Deals: ${created} created.`);
}

// Small deterministic PRNG so every fresh seed looks the same.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T extends string>(rnd: () => number, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  let r = rnd() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) if ((r -= w) < 0) return k;
  return entries[0]![0];
}

async function seedDemoOrders(refresh: boolean) {
  const DEMO_DOMAIN = "@seed.example.test";
  const demoWhere = { user: { email: { endsWith: DEMO_DOMAIN } } };
  const existing = await prisma.legacyOrder.count({ where: demoWhere });
  if (existing > 0 && !refresh) {
    console.log(`Demo orders: ${existing} already exist, skipped (use --refresh-demo to regenerate).`);
    return;
  }
  if (refresh) await prisma.legacyOrder.deleteMany({ where: demoWhere }); // order lines cascade

  // Demo customers get an unguessable random password, so nobody can log in as them.
  const names = ["Ayesha Khan", "Bilal Ahmed", "Sana Malik", "Usman Tariq", "Hira Siddiqui"];
  const users = [];
  for (const [i, name] of names.entries()) {
    const email = `demo${i + 1}${DEMO_DOMAIN}`;
    users.push(
      await prisma.legacyUser.upsert({
        where: { email },
        update: {},
        create: { email, name, passwordHash: await bcrypt.hash(randomUUID(), 4) },
      }),
    );
  }

  const items = await prisma.legacyMenuItem.findMany({ where: { available: true } });
  const activeDeals = await prisma.legacyDeal.findMany({ where: { isActive: true } });
  const rnd = mulberry32(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]!;
  const now = Date.now();
  const HOUR = 3_600_000;
  const todayStart = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(now)}T00:00:00+05:00`).getTime();

  const COUNT = 60;
  for (let i = 0; i < COUNT; i++) {
    // The first 8 orders are "just now" so the live board always has something on it;
    // the rest are spread over 30 days, skewed towards recent days.
    let createdAt: number;
    if (i < 8) createdAt = now - rnd() * 2.5 * HOUR;
    else {
      const daysAgo = Math.floor(30 * rnd() ** 1.4);
      createdAt = Math.min(todayStart - daysAgo * 24 * HOUR + (11 + rnd() * 11) * HOUR, now - HOUR * 3 * rnd() - 60_000);
    }
    const ageHours = (now - createdAt) / HOUR;
    const status: OrderStatus =
      ageHours < 3
        ? pickWeighted(rnd, { PENDING: 3, CONFIRMED: 2, PREPARING: 2.5, READY: 1.5, COMPLETED: 1, CANCELLED: 0.3, } as Record<OrderStatus, number>)
        : ageHours < 24
          ? pickWeighted(rnd, { COMPLETED: 75, READY: 10, PREPARING: 5, CANCELLED: 10 } as Record<OrderStatus, number>)
          : pickWeighted(rnd, { COMPLETED: 88, CANCELLED: 12 } as Record<OrderStatus, number>);
    const channel = pickWeighted<OrderChannel>(rnd, { WEB: 70, ANDROID: 15, IOS: 8, POS: 7 });

    const lines = new Map<number, { menuItemId: number; quantity: number; unitPriceCents: number }>();
    const wantsDeal = activeDeals.length > 0 && rnd() < 0.35;
    const itemCount = wantsDeal ? Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 3);
    for (let n = 0; n < itemCount; n++) {
      const m = pick(items);
      lines.set(m.id, { menuItemId: m.id, quantity: 1 + Math.floor(rnd() * 3), unitPriceCents: m.priceCents });
    }
    const dealLines = wantsDeal
      ? (() => {
          const d = pick(activeDeals);
          return [{ dealId: d.id, dealName: d.name, quantity: 1 + Math.floor(rnd() * 2), unitPriceCents: d.dealPriceCents }];
        })()
      : [];
    const totalCents = [...lines.values(), ...dealLines].reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);

    await prisma.legacyOrder.create({
      data: {
        userId: pick(users).id,
        status,
        channel,
        totalCents,
        notes: rnd() < 0.15 ? pick(["Extra napkins please", "Less spicy", "No onions", "Ring the bell"]) : null,
        createdAt: new Date(createdAt),
        items: { create: [...lines.values()] },
        deals: { create: dealLines },
      },
    });
  }
  console.log(`Demo orders: ${COUNT} created.`);
}

await seedMenu();
await seedDeals();
await seedDemoOrders(process.argv.includes("--refresh-demo"));
await prisma.$disconnect();
