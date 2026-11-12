import type { OrderCreateInput } from "@restoflux/contracts";
import { db } from "../../core/db/scoped.js";
import { fieldError, notFound } from "../../core/http/errors.js";

// COUPONS AND PROMOTIONS AT THE TILL.
// The till sends only a coupon code or a promotion id. This is the one place that decides whether the offer
// is valid right now at this branch and what it is worth, so a cashier (or a tampered request) cannot invent
// a discount. The result is turned into an ordinary order discount, so all the tax and total maths is shared.

export interface ResolvedOffer {
  kind: "COUPON" | "PROMOTION";
  id: string;
  label: string;
  /** In the order's own discount form (a percent such as 12.5, or minor units). */
  discount: { type: "PERCENT" | "AMOUNT"; value: number; reasonId: string; note: string };
  minSubtotalMinor: number;
}

/** "0300 123-4567" and "03001234567" are the same customer. */
export const normalizePhone = (p: string | null | undefined): string | null => {
  const s = (p ?? "").replace(/[\s()-]/g, "");
  return s ? s : null;
};

/** The branch's own calendar date, weekday and minutes since midnight. */
export function localParts(at: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, dow, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

interface PromotionRow { valueType: "PERCENT" | "AMOUNT"; value: number; validFrom: Date | null; validTo: Date | null; daysOfWeek: number[]; startTime: string | null; endTime: string | null; locationIds: string[]; isActive: boolean; minSubtotalMinor: number }

/** Why a promotion cannot be used right now at a branch, or null when it can. */
export function promotionProblem(p: PromotionRow, locationId: string, now: { date: string; dow: number; minutes: number }): string | null {
  if (!p.isActive) return "This promotion is switched off";
  if (day(p.validFrom) && now.date < day(p.validFrom)!) return "This promotion has not started yet";
  if (day(p.validTo) && now.date > day(p.validTo)!) return "This promotion has ended";
  if (p.daysOfWeek.length && !p.daysOfWeek.includes(now.dow)) return "This promotion does not run today";
  if (p.locationIds.length && !p.locationIds.includes(locationId)) return "This promotion does not run at this branch";
  if (p.startTime && p.endTime) {
    const s = toMinutes(p.startTime), e = toMinutes(p.endTime);
    const inside = s <= e ? now.minutes >= s && now.minutes < e : now.minutes >= s || now.minutes < e; // a window can cross midnight
    if (!inside) return `This promotion runs ${p.startTime} to ${p.endTime}`;
  }
  return null;
}

const asDiscount = (valueType: "PERCENT" | "AMOUNT", value: number) => ({ type: valueType, value: valueType === "PERCENT" ? value / 100 : value }); // basis points -> percent

/** Look up and validate the offer on an order request. Returns null when the order carries none. */
export async function resolveOffer(input: OrderCreateInput, now = new Date()): Promise<ResolvedOffer | null> {
  if (!input.offer) return null;
  if (input.discount) throw fieldError("offer", "Use a manual discount or an offer, not both");
  const location = await db.location.findFirst({ where: { id: input.locationId }, select: { id: true, timezone: true } });
  if (!location) throw notFound("branch");
  const local = localParts(now, location.timezone);

  if (input.offer.couponCode) {
    const code = input.offer.couponCode.trim();
    const c = await db.coupon.findFirst({ where: { code: { equals: code, mode: "insensitive" } } });
    if (!c || !c.isActive) throw fieldError("offer", "That coupon code is not valid");
    if (day(c.validFrom) && local.date < day(c.validFrom)!) throw fieldError("offer", "That coupon is not valid yet");
    if (day(c.validTo) && local.date > day(c.validTo)!) throw fieldError("offer", "That coupon has expired");
    if (c.maxUses !== null && c.usedCount >= c.maxUses) throw fieldError("offer", "That coupon has been used up");
    if (c.customerId) {
      const owner = await db.customer.findFirst({ where: { id: c.customerId }, select: { phone: true } });
      if (!owner?.phone || normalizePhone(input.customerPhone) !== owner.phone) throw fieldError("offer", "That coupon belongs to a particular customer. Enter their phone number on the order.");
    }
    return { kind: "COUPON", id: c.id, label: `Coupon ${c.code}`, discount: { ...asDiscount(c.valueType, c.value), reasonId: "", note: `Coupon ${c.code}` }, minSubtotalMinor: c.minSubtotalMinor };
  }

  const p = await db.promotion.findFirst({ where: { id: input.offer.promotionId } });
  if (!p) throw fieldError("offer", "That promotion does not exist");
  const problem = promotionProblem(p, location.id, local);
  if (problem) throw fieldError("offer", problem);
  return { kind: "PROMOTION", id: p.id, label: p.name, discount: { ...asDiscount(p.valueType, p.value), reasonId: "", note: p.name }, minSubtotalMinor: p.minSubtotalMinor };
}

/** The minimum spend is checked once the order's lines have been priced. */
export function assertMinimumSpend(offer: ResolvedOffer, subtotalMinor: number) {
  if (subtotalMinor < offer.minSubtotalMinor) throw fieldError("offer", `${offer.label} needs a bigger order: the minimum spend has not been reached`);
}
