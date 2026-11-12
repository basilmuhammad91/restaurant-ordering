import { parseArgs } from "node:util";
import { runAsTenant } from "../src/core/context/context.js";
import { unscopedDb } from "../src/core/db/client.js";
import { db } from "../src/core/db/scoped.js";
import { deleteInventory, deleteMarketing, deleteOperations, deletePurchasing } from "../src/core/db/purge.js";
import { postMovement } from "../src/modules/inventory/stock.js";

// Fills the DEMO organization with sample data for the back-office modules: inventory and recipes, suppliers,
// customers and offers, delivery, staff and feedback, so every screen has something to show.
//   npm run seed:demo-ops              add it (does nothing if the demo already has inventory items)
//   npm run seed:demo-ops -- --reset   remove the demo's inventory, purchasing, marketing and staff data, then add it again
// Costs are typed in rupees and stored in minor units (x100).

const { values } = parseArgs({ options: { reset: { type: "boolean", default: false } } });
const tenant = await unscopedDb.tenant.findUnique({ where: { slug: "demo" } });
if (!tenant) { console.error("There is no demo tenant. Run: npm run seed:demo"); process.exit(1); }

if (values.reset) {
  await unscopedDb.$transaction(async (tx) => {
    await deleteOperations(tx, tenant.id);
    await deleteMarketing(tx, tenant.id);
    await deletePurchasing(tx, tenant.id);
    await deleteInventory(tx, tenant.id);
  }, { timeout: 60_000 });
  console.log("Removed the demo's inventory, purchasing, marketing and staff data.");
}

const rs = (n: number) => Math.round(n * 100);
const day = (offset: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offset); return d; };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const monday = (() => { const d = day(0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d; })();

await runAsTenant(tenant.id, async () => {
  if ((await db.inventoryItem.count()) > 0) { console.log("The demo already has inventory. Nothing changed. (npm run seed:demo-ops -- --reset rebuilds it.)"); return; }
  const tenantId = tenant.id;
  const branches = await db.location.findMany({ where: { type: "BRANCH" }, orderBy: { code: "asc" } });
  const khi = branches.find((b) => b.code === "KHI-01") ?? branches[0]!;
  const lhe = branches.find((b) => b.code === "LHE-01") ?? branches[1] ?? khi;

  // ---- inventory items: [name, unit, kind, category, cost/unit, reorder, par]
  const defs: [string, string, "RAW" | "PREP" | "PACKAGING", string, number, number | null, number | null][] = [
    ["Chicken", "kg", "RAW", "Meat", 650, 15, 60], ["Beef mince", "kg", "RAW", "Meat", 1400, 10, 40], ["Mutton", "kg", "RAW", "Meat", 2200, 8, 30],
    ["Basmati rice", "kg", "RAW", "Dry goods", 380, 25, 100], ["Cooking oil", "l", "RAW", "Dry goods", 520, 20, 80], ["Flour", "kg", "RAW", "Dry goods", 110, 20, 80],
    ["Onion", "kg", "RAW", "Produce", 120, 15, 50], ["Tomato", "kg", "RAW", "Produce", 160, 15, 50], ["Yogurt", "kg", "RAW", "Dairy", 240, 10, 30],
    ["Spice mix", "kg", "RAW", "Dry goods", 900, 3, 12], ["Soft drink cans", "pcs", "RAW", "Beverages", 70, 48, 240], ["Take-away boxes", "pcs", "PACKAGING", "Packaging", 18, 200, 800],
    ["Tikka marinade", "kg", "PREP", "Prep", 0, 5, 20],
  ];
  const items = new Map<string, { id: string }>();
  for (const [name, unit, kind, category, cost, reorderLevel, parLevel] of defs) {
    items.set(name, await db.inventoryItem.create({ data: { tenantId, name, unit, kind, category, referenceCost: rs(cost), reorderLevel, parLevel } }));
  }
  const item = (n: string) => items.get(n)!.id;

  // ---- opening stock (a few items deliberately low or out, so alerts and suggestions have something to show)
  const opening: Record<string, [number, number]> = { Chicken: [40, 12], "Beef mince": [18, 4], Mutton: [14, 6], "Basmati rice": [60, 14], "Cooking oil": [45, 9], Flour: [50, 30], Onion: [35, 0], Tomato: [28, 22], Yogurt: [14, 11], "Spice mix": [6, 4], "Soft drink cans": [180, 30], "Take-away boxes": [500, 120] };
  for (const [name, [khiQty, lheQty]] of Object.entries(opening)) {
    const cost = defs.find((d) => d[0] === name)![4] * 100;
    if (khiQty > 0) await db.$transaction((tx) => postMovement(tx, { locationId: khi.id, itemId: item(name), type: "OPENING", qty: khiQty, unitCost: cost, reason: "Opening stock" }));
    if (lheQty > 0 && lhe.id !== khi.id) await db.$transaction((tx) => postMovement(tx, { locationId: lhe.id, itemId: item(name), type: "OPENING", qty: lheQty, unitCost: cost, reason: "Opening stock" }));
  }
  await db.$transaction((tx) => postMovement(tx, { locationId: khi.id, itemId: item("Tomato"), type: "WASTE", qty: -3, reason: "Spoiled in the heat" }));
  await db.$transaction((tx) => postMovement(tx, { locationId: khi.id, itemId: item("Chicken"), type: "STAFF_MEAL", qty: -2, reason: "Staff lunch" }));

  // ---- recipes for the demo menu (only for dishes that exist)
  const recipe = async (product: string, variant: string | null, lines: [string, number, number?][], yieldQty = 1) => {
    const v = await db.productVariant.findFirst({ where: { product: { name: product }, ...(variant ? { name: variant } : {}) } });
    if (!v) return;
    const r = await db.recipe.create({ data: { tenantId, variantId: v.id, yieldQty } });
    await db.recipeLine.createMany({ data: lines.map(([n, qty, waste], i) => ({ tenantId, recipeId: r.id, itemId: item(n), qty, wastePercent: waste ?? 0, sortOrder: i })) });
  };
  await recipe("Chicken Tikka", "Quarter", [["Chicken", 0.3, 10], ["Tikka marinade", 0.05], ["Onion", 0.05]]);
  await recipe("Chicken Tikka", "Half", [["Chicken", 0.6, 10], ["Tikka marinade", 0.1], ["Onion", 0.1]]);
  await recipe("Seekh Kebab", null, [["Beef mince", 0.25, 5], ["Spice mix", 0.01], ["Onion", 0.04]]);
  await recipe("Beef Boti", null, [["Beef mince", 0.3, 5], ["Yogurt", 0.05], ["Spice mix", 0.01]]);
  await recipe("Chicken Karahi", "Half", [["Chicken", 0.5, 10], ["Tomato", 0.4], ["Cooking oil", 0.1], ["Spice mix", 0.02]]);
  await recipe("Chicken Karahi", "Full", [["Chicken", 1, 10], ["Tomato", 0.8], ["Cooking oil", 0.2], ["Spice mix", 0.04]]);
  await recipe("Mutton Karahi", "Half", [["Mutton", 0.5, 12], ["Tomato", 0.4], ["Cooking oil", 0.1], ["Spice mix", 0.02]]);
  await recipe("Chicken Biryani", "Single", [["Chicken", 0.2, 10], ["Basmati rice", 0.15], ["Onion", 0.08], ["Cooking oil", 0.04], ["Spice mix", 0.01]]);
  const prepRecipe = await db.recipe.create({ data: { tenantId, prepItemId: item("Tikka marinade"), yieldQty: 5, notes: "Rest overnight" } });
  await db.recipeLine.createMany({ data: [["Yogurt", 3], ["Spice mix", 0.4], ["Cooking oil", 0.5]].map(([n, qty], i) => ({ tenantId, recipeId: prepRecipe.id, itemId: item(n as string), qty: qty as number, sortOrder: i })) });

  // ---- suppliers, what they sell, an order waiting for approval, and two invoices (one overdue)
  const mk = (name: string, code: string, terms: number, contactName: string, phone: string) => db.supplier.create({ data: { tenantId, name, code, paymentTermsDays: terms, contactName, phone } });
  const [fresh, meats, dry] = [await mk("Karachi Fresh Produce", "KFP", 7, "Imran Qureshi", "0321 555 0101"), await mk("Al-Madina Meats", "AMM", 3, "Haji Rashid", "0333 555 0202"), await mk("Gul Dry Goods", "GDG", 14, "Sana Gul", "0300 555 0303")];
  const sells = (s: { id: string }, n: string, pack: string, qty: number, price: number) => db.supplierItem.create({ data: { tenantId, supplierId: s.id, itemId: item(n), packName: pack, packQty: qty, priceMinor: rs(price), isPreferred: true } });
  await Promise.all([
    sells(fresh, "Onion", "Sack 25 kg", 25, 2800), sells(fresh, "Tomato", "Crate 10 kg", 10, 1500), sells(fresh, "Yogurt", "Tub 5 kg", 5, 1150),
    sells(meats, "Chicken", "Carton 10 kg", 10, 6400), sells(meats, "Beef mince", "Pack 5 kg", 5, 6900), sells(meats, "Mutton", "Pack 5 kg", 5, 10800),
    sells(dry, "Basmati rice", "Sack 25 kg", 25, 9300), sells(dry, "Cooking oil", "Drum 20 l", 20, 10200), sells(dry, "Flour", "Sack 20 kg", 20, 2150), sells(dry, "Spice mix", "Tin 2 kg", 2, 1800),
    sells(dry, "Soft drink cans", "Case 24", 24, 1600), sells(dry, "Take-away boxes", "Bundle 100", 100, 1700),
  ]);
  const po = await db.purchaseOrder.create({ data: { tenantId, locationId: khi.id, supplierId: meats.id, number: "PO-DEMO-0001", currencyCode: khi.currencyCode, totalMinor: rs(64000 + 34500), expectedDate: day(2) } });
  await db.purchaseOrderLine.createMany({ data: [{ tenantId, orderId: po.id, itemId: item("Chicken"), packName: "Carton 10 kg", packQty: 10, orderedPacks: 10, unitPriceMinor: rs(6400), lineTotalMinor: rs(64000) }, { tenantId, orderId: po.id, itemId: item("Beef mince"), packName: "Pack 5 kg", packQty: 5, orderedPacks: 5, unitPriceMinor: rs(6900), lineTotalMinor: rs(34500) }] });
  await db.supplierInvoice.create({ data: { tenantId, supplierId: dry.id, invoiceNo: "GDG-2291", invoiceDate: day(-40), dueDate: day(-26), totalMinor: rs(48200) } });
  const paid = await db.supplierInvoice.create({ data: { tenantId, supplierId: fresh.id, invoiceNo: "KFP-1180", invoiceDate: day(-6), dueDate: day(1), totalMinor: rs(21500), paidMinor: rs(10000), status: "PARTIALLY_PAID" } });
  await db.supplierPayment.create({ data: { tenantId, invoiceId: paid.id, amountMinor: rs(10000), method: "Bank transfer", reference: "TT-4471" } });

  // ---- customers, loyalty, a coupon and a promotion
  const people: [string, string, number][] = [["Ayesha Khan", "03001230001", 180], ["Bilal Ahmed", "03001230002", 90], ["Sara Malik", "03001230003", 340], ["Omar Siddiqui", "03001230004", 40], ["Hina Raza", "03001230005", 0], ["Zain Ali", "03001230006", 75]];
  for (const [name, phone, points] of people) await db.customer.create({ data: { tenantId, name, phone, loyaltyPoints: points, marketingOptIn: points > 50, email: `${name.split(" ")[0]!.toLowerCase()}@example.com` } });
  await db.loyaltyProgram.create({ data: { tenantId, isEnabled: true, earnPerPointMinor: rs(100), redeemValueMinor: rs(1), minRedeemPoints: 100 } });
  await db.coupon.create({ data: { tenantId, code: "WELCOME10", description: "10% off for new customers", valueType: "PERCENT", value: 1000, minSubtotalMinor: rs(500), validTo: day(90) } });
  await db.coupon.create({ data: { tenantId, code: "FREEDRINK", description: "Rs. 150 off", valueType: "AMOUNT", value: rs(150), maxUses: 100 } });
  await db.promotion.create({ data: { tenantId, name: "Weekday lunch", description: "15% off, Monday to Friday 12:00-15:00", valueType: "PERCENT", value: 1500, daysOfWeek: [1, 2, 3, 4, 5], startTime: "12:00", endTime: "15:00" } });
  await db.promotion.create({ data: { tenantId, name: "Family night", description: "Rs. 300 off orders over Rs. 3,000", valueType: "AMOUNT", value: rs(300), minSubtotalMinor: rs(3000), daysOfWeek: [5, 6, 0] } });

  // ---- delivery
  await db.deliveryZone.createMany({ data: [["Clifton", 150, 35], ["DHA", 200, 40], ["Gulshan-e-Iqbal", 250, 50]].map(([name, fee, mins]) => ({ tenantId, locationId: khi.id, name: name as string, feeMinor: rs(fee as number), estimatedMinutes: mins as number })) });
  await db.rider.createMany({ data: [["Bilal Hussain", "03211110001", "Bike"], ["Kamran Shah", "03211110002", "Bike"], ["Zeeshan Ali", "03211110003", "Van"]].map(([name, phone, vehicle]) => ({ tenantId, name: name!, phone, vehicle })) });

  // ---- staff, this week's roster, and last week's time clock
  const staff: [string, string, number][] = [["Ayesha Noor", "Manager", 900], ["Hamza Tariq", "Cashier", 450], ["Rabia Saeed", "Cashier", 450], ["Usman Gill", "Head cook", 700], ["Fahad Mir", "Cook", 500], ["Nadia Butt", "Waiter", 400], ["Salman Iqbal", "Waiter", 400], ["Ali Raza", "Dishwasher", 350]];
  const emps = [];
  for (const [name, position, rate] of staff) emps.push(await db.employee.create({ data: { tenantId, locationId: khi.id, name, position, hourlyRateMinor: rs(rate), startDate: day(-200) } }));
  const rosterRows = emps.flatMap((e, i) => Array.from({ length: 7 }, (_, d) => ({ e, d })).filter(({ d }) => (d + i) % 7 !== 6 && (d + i) % 7 !== 3).map(({ e: emp, d }) => {
    const late = (d + i) % 2 === 0;
    return { tenantId, locationId: khi.id, employeeId: emp.id, shiftDate: new Date(monday.getTime() + d * 86_400_000), startTime: late ? "16:00" : "11:00", endTime: late ? "00:00" : "19:00", position: emp.position };
  }));
  await db.rosterShift.createMany({ data: rosterRows });
  const entries = [];
  for (const [i, e] of emps.entries()) for (let d = 1; d <= 6; d++) {
    if ((d + i) % 4 === 0) continue;
    const start = new Date(day(-d).getTime() + (i % 2 === 0 ? 11 : 16) * 3_600_000);
    entries.push({ tenantId, locationId: khi.id, employeeId: e.id, clockInAt: start, clockOutAt: new Date(start.getTime() + 8 * 3_600_000), breakMinutes: 30 });
  }
  await db.timeEntry.createMany({ data: entries });

  // ---- feedback
  const comments: [number, string | null][] = [[5, "Best karahi in town, fast service."], [4, "Great food, a bit loud."], [5, null], [2, "Order took 50 minutes and the naan was cold."], [3, "Okay, portions smaller than before."], [5, "Lovely staff."], [1, "Wrong order delivered."], [4, "Will come again."]];
  for (const [i, [rating, comment]] of comments.entries()) await db.feedback.create({ data: { tenantId, locationId: i % 3 === 2 && lhe.id !== khi.id ? lhe.id : khi.id, rating, comment, source: i % 2 ? "TABLE" : "STAFF", createdAt: new Date(Date.now() - i * 86_400_000) } });

  await db.receiptTemplate.create({ data: { tenantId, headerText: "Open daily 11 am to midnight\nNTN 1234567-8", footerText: "Thank you for dining with us!\nFollow us @restoflux", showTaxBreakdown: true, showCustomer: true, showCashier: true } });
  console.log(`Added demo back-office data: ${defs.length} inventory items with recipes and stock, 3 suppliers, ${people.length} customers, 2 coupons, 2 promotions, 3 delivery zones, 3 riders, ${staff.length} employees (roster week of ${iso(monday)}), ${entries.length} time entries and ${comments.length} feedback entries.`);
});
await unscopedDb.$disconnect();
