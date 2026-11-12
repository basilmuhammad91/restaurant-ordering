import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { applyTender, businessDateOf, expectedCash, paymentStatusFor, type OrderCreateInput, type PriceChannel } from "@restoflux/contracts";
import { runAsTenant } from "../src/core/context/context.js";
import { unscopedDb } from "../src/core/db/client.js";
import { deleteSales } from "../src/core/db/purge.js";
import { db } from "../src/core/db/scoped.js";
import { buildSellableMenu } from "../src/modules/catalog/availability.js";
import { draftFromMenu, type Menu } from "../src/modules/orders/engine.js";
import { buildSalesSummary, shiftFigures } from "../src/modules/orders/sales.js";

// DEMO ORDERS: a few days of believable trading for the demo tenant, so the dashboard, order history, shifts
// and Z-reports have something real to show. Orders are priced with the SAME engine the API uses (from the
// branch's real menu and tax rules), then inserted in bulk. Deterministic: the same run gives the same data.
//   npm run seed:demo-orders              add 10 days (does nothing if the tenant already has orders)
//   npm run seed:demo-orders -- --days 30 --reset

const { values } = parseArgs({ options: { days: { type: "string", default: "10" }, reset: { type: "boolean", default: false } } });
const DAYS = Math.min(Math.max(Number(values.days) || 10, 1), 60);

const tenant = await unscopedDb.tenant.findUnique({ where: { slug: "demo" } });
if (!tenant) {
  console.error("There is no demo tenant. Run: npm run seed:demo");
  process.exit(1);
}
if (values.reset) {
  await unscopedDb.$transaction(async (tx) => deleteSales(tx, tenant.id), { timeout: 120_000 });
  console.log("Removed the existing demo orders.");
}

// ---- a small deterministic random generator (mulberry32) ----
let seed = 20261110;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const chance = (p: number) => rnd() < p;
const weighted = <T,>(xs: readonly [T, number][]): T => { let r = rnd() * xs.reduce((a, [, w]) => a + w, 0); for (const [x, w] of xs) if ((r -= w) <= 0) return x; return xs[0]![0]; };

/** The UTC instant at which a branch's wall clock shows yyyy-mm-dd HH:MM. */
function localToUtc(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  let guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(guess));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    const shown = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
    guess -= shown - Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  }
  return new Date(guess);
}
const dayString = (daysAgo: number, tz: string) => {
  const now = new Date();
  const d = new Date(now.getTime() - daysAgo * 86_400_000);
  return businessDateOf(d, tz, "00:00");
};

await runAsTenant(tenant.id, async () => {
  if ((await db.order.count()) > 0) {
    console.log("The demo tenant already has orders. Nothing changed. (Use --reset to rebuild.)");
    return;
  }
  const branches = await db.location.findMany({ where: { type: "BRANCH" }, orderBy: { code: "asc" } });
  const methods = await db.paymentMethod.findMany();
  const reasons = await db.reasonCode.findMany();
  const cashier = await db.user.findFirstOrThrow({ where: { email: "cashier@demo.restoflux.test" } });
  const manager = await db.user.findFirstOrThrow({ where: { email: "branch.manager@demo.restoflux.test" } });
  const m = (type: string, name?: string) => methods.find((x) => x.type === type && (!name || x.name === name))!;
  const reason = (type: string) => reasons.filter((r) => r.type === type && !r.requiresNote);

  const tenantId = tenant.id;
  const orderRows: any[] = [], lineRows: any[] = [], modRows: any[] = [], taxRows: any[] = [], discRows: any[] = [], eventRows: any[] = [], paymentRows: any[] = [], refundRows: any[] = [];
  const sequences = new Map<string, number>(); // locationId|date -> last number
  const shiftRows: any[] = [], movementRows: any[] = [];
  const shiftPlans: { id: string; location: (typeof branches)[number]; date: string }[] = [];
  let orderCount = 0;

  for (const loc of branches) {
    const register = await db.cashRegister.create({ data: { tenantId, locationId: loc.id, name: "Main till" } });
    const enabled = new Set((await db.locationPaymentMethod.findMany({ where: { locationId: loc.id, isEnabled: true } })).map((l) => l.paymentMethodId));
    const accepted = methods.filter((x) => enabled.has(x.id));
    const acceptedOf = (type: string) => accepted.filter((x) => x.type === type);
    const busy = loc.code === "KHI-01" ? 1 : loc.code === "LHE-01" ? 0.8 : 0.5;
    // the menu at lunch and at dinner (Saffron serves different menus at those hours)
    const menuAt = async (channel: PriceChannel, date: string, minutes: number): Promise<Menu> => buildSellableMenu({ locationId: loc.id, channel, at: localToUtc(date, minutes, loc.timezone).toISOString() });
    const probeDate = dayString(1, loc.timezone);
    const menus: Record<string, Menu> = {};
    for (const channel of ["POS", "WEB"] as const) for (const slot of ["lunch", "dinner"] as const) menus[`${channel}:${slot}`] = await menuAt(channel, probeDate, slot === "lunch" ? 13 * 60 : 20 * 60);

    for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo--) {
      const date = dayString(daysAgo, loc.timezone);
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      const weekend = dow === 5 || dow === 6;
      const count = Math.round((14 + rnd() * 10) * busy * (weekend ? 1.5 : 1));
      const shiftId = randomUUID();
      shiftPlans.push({ id: shiftId, location: loc, date });
      const times = Array.from({ length: count }, () => weighted([[13 * 60 + Math.floor(rnd() * 120), 3], [19 * 60 + Math.floor(rnd() * 150), 4], [11 * 60 + 30 + Math.floor(rnd() * 90), 1], [22 * 60 + Math.floor(rnd() * 90), 1]] as [number, number][])).sort((a, b) => a - b);
      let cashSales = 0, cashRefunds = 0;

      for (const [i, minutes] of times.entries()) {
        const isToday = daysAgo === 0;
        const channel: PriceChannel = weighted([["POS", 80], ["WEB", 12], ["AGGREGATOR", 8]] as [PriceChannel, number][]);
        const menu = menus[`${channel === "POS" ? "POS" : "WEB"}:${minutes < 17 * 60 ? "lunch" : "dinner"}`]!;
        const products = menu.categories.flatMap((c) => c.products);
        if (products.length === 0) continue;
        const orderType = weighted([["DINE_IN", 45], ["TAKEAWAY", 35], ["DELIVERY", 20]] as ["DINE_IN" | "TAKEAWAY" | "DELIVERY", number][]);
        const lines: OrderCreateInput["lines"] = [];
        for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k++) {
          const p = pick(products);
          const v = pick(p.variants);
          const mods: string[] = [];
          for (const g of p.modifierGroups) {
            const want = g.minSelect > 0 ? g.minSelect : chance(0.35) ? 1 : 0;
            const opts = [...g.options];
            for (let z = 0; z < Math.min(want, g.maxSelect, opts.length); z++) mods.push(opts.splice(Math.floor(rnd() * opts.length), 1)[0]!.id);
          }
          lines.push({ kind: "item", variantId: v.id, quantity: 1 + (chance(0.25) ? 1 : 0), modifierOptionIds: mods, notes: null });
        }
        if (menu.combos.length && chance(0.15)) {
          const c = pick(menu.combos);
          lines.push({ kind: "combo", comboId: c.id, quantity: 1, choices: c.slots.filter((s) => s.options.length > 1).map((s) => ({ slotId: s.id, optionId: pick(s.options).id })), notes: null });
        }
        const discountWanted = chance(0.1);
        const at = localToUtc(date, minutes, loc.timezone);
        if (at.getTime() > Date.now() - 60_000) continue; // never in the future
        let draft;
        try {
          draft = draftFromMenu(menu, { locationId: loc.id, orderType, channel, lines, deliveryFeeMinor: orderType === "DELIVERY" ? ({ PKR: 15_000, AED: 1_000, USD: 500 } as Record<string, number>)[loc.currencyCode] ?? 0 : 0, discount: discountWanted ? { type: "PERCENT", value: 10, reasonId: "x" } : null }, at);
        } catch { continue; }

        const id = randomUUID();
        const bd = businessDateOf(at, loc.timezone, loc.businessDayStartTime ?? "05:00");
        const key = `${loc.id}|${bd}`;
        const number = (sequences.get(key) ?? 0) + 1;
        sequences.set(key, number);

        // how far along the order is: yesterday and earlier is finished; today's latest ones are still in the kitchen
        const recent = isToday && i >= times.length - 3;
        const cancelled = !recent && chance(0.04);
        const status = cancelled ? "CANCELLED" : recent ? weighted([["CONFIRMED", 3], ["PREPARING", 3], ["READY", 2]] as ["CONFIRMED" | "PREPARING" | "READY", number][]) : "COMPLETED";
        const total = draft.priced.totalMinor;
        const payNow = !cancelled && (status === "COMPLETED" || chance(0.4));
        const completedAt = status === "COMPLETED" ? new Date(at.getTime() + (15 + rnd() * 25) * 60_000) : null;

        let paid = 0, tip = 0;
        if (payNow && total > 0) {
          const kind = channel === "AGGREGATOR" ? "CASH" : weighted([["CASH", 45], ["CARD", 40], ["WALLET", 15]] as [string, number][]);
          const options = acceptedOf(kind).length ? acceptedOf(kind) : acceptedOf("CARD");
          const method = pick(options);
          const isCash = method.type === "CASH";
          const tendered = isCash ? Math.ceil(total / 10_000) * 10_000 + (chance(0.3) ? 50_000 : 0) : total;
          const applied = applyTender({ dueMinor: total, tenderedMinor: Math.max(tendered, total), isCash });
          tip = chance(0.1) ? Math.round(total * 0.05 / 100) * 100 : 0;
          paid = applied.appliedMinor;
          paymentRows.push({ id: randomUUID(), tenantId, locationId: loc.id, orderId: id, businessDate: new Date(`${bd}T00:00:00Z`), paymentMethodId: method.id, amountMinor: applied.appliedMinor, tenderedMinor: Math.max(tendered, total), changeMinor: applied.changeMinor, tipMinor: tip, currencyCode: loc.currencyCode, reference: method.requiresReference ? `REF${100000 + Math.floor(rnd() * 899999)}` : null, status: "CAPTURED", cashShiftId: shiftId, receivedById: cashier.id, occurredAt: new Date(at.getTime() + 8 * 60_000) });
          if (isCash) cashSales += applied.appliedMinor + tip;
        }
        let refunded = 0;
        if (paid > 0 && status === "COMPLETED" && chance(0.03)) {
          refunded = Math.min(paid, Math.round(total / 3 / 100) * 100 || 100);
          const rm = m("CASH");
          cashRefunds += refunded;
          refundRows.push({ id: randomUUID(), tenantId, locationId: loc.id, orderId: id, businessDate: new Date(`${bd}T00:00:00Z`), amountMinor: refunded, paymentMethodId: rm.id, reasonId: pick(reason("REFUND")).id, note: null, cashShiftId: shiftId, requestedById: manager.id, occurredAt: new Date(at.getTime() + 60 * 60_000) });
        }

        orderRows.push({
          id, tenantId, brandId: loc.brandId!, locationId: loc.id, businessDate: new Date(`${bd}T00:00:00Z`), orderType, channel, status, paymentStatus: paymentStatusFor(total, paid, refunded), displayNumber: number,
          aggregatorName: channel === "AGGREGATOR" ? "Foodpanda" : null, aggregatorRef: channel === "AGGREGATOR" ? `FP-${10000 + Math.floor(rnd() * 89999)}` : null,
          customerName: chance(0.4) ? pick(["Ayesha", "Bilal", "Hira", "Imran", "Sana", "Kamran", "Noor", "Rashid"]) : null, customerPhone: null, tableId: null, covers: orderType === "DINE_IN" ? 1 + Math.floor(rnd() * 5) : null,
          deliveryAddress: orderType === "DELIVERY" ? { line1: `${1 + Math.floor(rnd() * 99)} Demo Street`, city: loc.city } : undefined, currencyCode: loc.currencyCode,
          subtotalMinor: draft.priced.subtotalMinor, discountMinor: draft.priced.discountMinor, taxMinor: draft.priced.taxMinor, deliveryFeeMinor: draft.priced.deliveryFeeMinor, tipMinor: tip, totalMinor: total, paidMinor: paid, refundedMinor: refunded,
          pricesIncludeTax: draft.pricesIncludeTax, notes: null, occurredAt: at, placedAt: at, completedAt, cancelledAt: cancelled ? new Date(at.getTime() + 5 * 60_000) : null, createdById: cashier.id, cashShiftId: paid > 0 ? shiftId : null,
        });
        const byKey = new Map(draft.priced.lines.map((p) => [p.key, p]));
        const lineStatus = status === "CANCELLED" ? "VOIDED" : status === "COMPLETED" ? "SERVED" : status === "READY" ? "READY" : status === "PREPARING" ? "PREPARING" : "NEW";
        for (const l of draft.lines) {
          const p = byKey.get(l.id);
          lineRows.push({ id: l.id, tenantId, locationId: loc.id, orderId: id, parentLineId: l.parentLineId, kind: l.kind, variantId: l.variantId, comboId: l.comboId, nameSnapshot: l.name, variantNameSnapshot: l.variantName, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, modifiersTotalMinor: l.modifiersTotalMinor, lineSubtotalMinor: p?.subtotalMinor ?? 0, discountMinor: p?.discountMinor ?? 0, taxMinor: p?.taxMinor ?? 0, lineTotalMinor: p?.totalMinor ?? 0, stationKey: l.stationKey, status: lineStatus, sentToKitchenAt: at, notes: l.notes, sortOrder: l.sortOrder });
          for (const mm of l.modifiers) modRows.push({ id: randomUUID(), tenantId, lineId: l.id, optionId: mm.optionId, nameSnapshot: mm.name, priceMinor: mm.priceMinor, quantity: 1 });
        }
        for (const p of draft.priced.lines) for (const t of p.taxLines) taxRows.push({ id: randomUUID(), tenantId, lineId: p.key, ruleId: t.ruleId ?? null, ruleNameSnapshot: t.name, authorityCode: t.authorityCode, rateBp: t.rateBp, baseMinor: t.baseMinor, taxMinor: t.taxMinor, isInclusive: t.isInclusive });
        if (discountWanted && draft.priced.discountMinor > 0) discRows.push({ id: randomUUID(), tenantId, orderId: id, source: "MANUAL", valueType: "PERCENT", value: 1000, amountMinor: draft.priced.discountMinor, reasonId: pick(reason("DISCOUNT")).id, note: null, appliedById: manager.id });
        eventRows.push({ id: randomUUID(), tenantId, orderId: id, fromStatus: null, toStatus: "CONFIRMED", at, byUserId: cashier.id });
        if (status !== "CONFIRMED") eventRows.push({ id: randomUUID(), tenantId, orderId: id, fromStatus: "CONFIRMED", toStatus: status, at: completedAt ?? new Date(at.getTime() + 10 * 60_000), byUserId: cashier.id });
        orderCount++;
      }

      // the shift that traded that day: opened before lunch, closed after dinner (today's is still open)
      const float = 5_000_00;
      const closed = daysAgo > 0;
      const variance = closed ? weighted([[0, 6], [-20_000, 1], [-5_000, 1], [10_000, 1]] as [number, number][]) : 0;
      const expected = expectedCash({ openingFloatMinor: float, cashSalesMinor: cashSales, cashRefundsMinor: cashRefunds, cashInMinor: 0, cashOutMinor: 0, paidOutMinor: 0, safeDropsMinor: 0 });
      shiftRows.push({
        id: shiftId, tenantId, locationId: loc.id, registerId: register.id, businessDate: new Date(`${date}T00:00:00Z`), status: closed ? "CLOSED" : "OPEN", currencyCode: loc.currencyCode, openedById: cashier.id, openedAt: localToUtc(date, 10 * 60, loc.timezone),
        openingFloatMinor: float, closedById: closed ? manager.id : null, closedAt: closed ? localToUtc(date, 23 * 60 + 50, loc.timezone) : null, expectedCashMinor: closed ? expected : null, countedCashMinor: closed ? expected + variance : null, varianceMinor: closed ? variance : null, isBlindClose: false,
      });
    }
  }

  // ---- write everything in a handful of bulk inserts ----
  const chunk = async <T,>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) => { for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size)); };
  await chunk(shiftRows, 500, (d) => db.cashShift.createMany({ data: d }));
  await chunk(orderRows, 400, (d) => db.order.createMany({ data: d }));
  await chunk(lineRows, 800, (d) => db.orderLine.createMany({ data: d }));
  await chunk(modRows, 1000, (d) => db.orderLineModifier.createMany({ data: d }));
  await chunk(taxRows, 1000, (d) => db.orderLineTax.createMany({ data: d }));
  await chunk(discRows, 500, (d) => db.orderDiscount.createMany({ data: d }));
  await chunk(eventRows, 1000, (d) => db.orderStatusEvent.createMany({ data: d }));
  await chunk(paymentRows, 800, (d) => db.payment.createMany({ data: d }));
  await chunk(refundRows, 500, (d) => db.refund.createMany({ data: d }));
  await chunk(movementRows, 500, (d) => db.cashMovement.createMany({ data: d }));
  await db.orderSequence.createMany({ data: [...sequences.entries()].map(([k, lastNumber]) => { const [locationId, d] = k.split("|") as [string, string]; return { tenantId, locationId, businessDate: new Date(`${d}T00:00:00Z`), lastNumber }; }) });

  // ---- an immutable Z-report for every closed shift ----
  let reports = 0;
  for (const plan of shiftPlans) {
    const shift = await db.cashShift.findFirstOrThrow({ where: { id: plan.id } });
    if (shift.status !== "CLOSED") continue;
    const figures = await shiftFigures(db as never, shift);
    const sales = await buildSalesSummary({ locationIds: [plan.location.id], from: plan.date, to: plan.date, shiftId: shift.id });
    await db.zReport.create({
      data: {
        tenantId, locationId: plan.location.id, businessDate: shift.businessDate, scope: "SHIFT", cashShiftId: shift.id, generatedById: manager.id, generatedAt: shift.closedAt!,
        data: JSON.parse(JSON.stringify({ location: { name: plan.location.name, currencyCode: plan.location.currencyCode }, shift: { ...shift, registerName: "Main till", locationName: plan.location.name, openedByName: cashier.name, closedByName: manager.name, businessDate: plan.date }, sales: sales[0] ?? null, cash: { ...figures, countedCashMinor: shift.countedCashMinor, varianceMinor: shift.varianceMinor } })),
      },
    });
    reports++;
  }
  console.log(`Added ${orderCount} demo orders over ${DAYS} days at ${branches.length} branches, ${shiftRows.length} shifts and ${reports} Z-reports.`);
});
await unscopedDb.$disconnect();
