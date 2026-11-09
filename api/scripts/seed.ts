import { prisma } from "../src/lib/prisma.js";

// Sample menu. Like a Laravel seeder, but idempotent: safe to run repeatedly.
// Existing categories/items are left untouched (so your edits are never overwritten).
const menu: Record<string, Array<{ name: string; description: string; priceCents: number }>> = {
  Starters: [
    { name: "Bruschetta", description: "Grilled bread, tomato, basil, garlic, olive oil", priceCents: 750 },
    { name: "Garlic Prawns", description: "Pan-fried prawns in garlic butter", priceCents: 1150 },
    { name: "Tomato Soup", description: "Roasted tomato soup with fresh cream", priceCents: 650 },
  ],
  Mains: [
    { name: "Margherita Pizza", description: "Tomato, mozzarella, fresh basil", priceCents: 1300 },
    { name: "Spaghetti Carbonara", description: "Pancetta, egg, pecorino, black pepper", priceCents: 1450 },
    { name: "Grilled Salmon", description: "Lemon herb salmon with seasonal vegetables", priceCents: 1850 },
  ],
  Desserts: [
    { name: "Tiramisu", description: "Espresso-soaked sponge with mascarpone", priceCents: 800 },
    { name: "Chocolate Lava Cake", description: "Warm chocolate cake with a molten centre", priceCents: 850 },
  ],
  Drinks: [
    { name: "Fresh Lemonade", description: "House-squeezed lemons, mint", priceCents: 400 },
    { name: "Espresso", description: "Double shot", priceCents: 350 },
  ],
};

let created = 0;
for (const [categoryName, items] of Object.entries(menu)) {
  const category = await prisma.category.upsert({
    where: { name: categoryName },
    update: {},
    create: { name: categoryName },
  });
  for (const item of items) {
    const exists = await prisma.menuItem.findFirst({ where: { name: item.name, categoryId: category.id } });
    if (!exists) {
      await prisma.menuItem.create({ data: { ...item, categoryId: category.id } });
      created++;
    }
  }
}
console.log(`Seed complete: ${created} new menu item(s) created.`);
await prisma.$disconnect();
