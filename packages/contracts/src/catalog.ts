// Pure catalog rules shared by the API and the admin UI: which price applies, and whether a menu is
// being served right now. No database, no framework, so they are cheap to unit test.

export const PRICE_CHANNELS = ["POS", "WEB", "ANDROID", "IOS", "PHONE", "AGGREGATOR"] as const;
export type PriceChannel = (typeof PRICE_CHANNELS)[number];

/** Dietary and display indicators (the "Indicators" screen of other POS products). */
export const PRODUCT_TAGS = ["VEGETARIAN", "VEGAN", "HALAL", "SPICY", "GLUTEN_FREE", "NEW", "BESTSELLER", "CHEFS_PICK"] as const;
export type ProductTag = (typeof PRODUCT_TAGS)[number];

export const ALLERGENS = ["GLUTEN", "DAIRY", "NUTS", "PEANUTS", "EGG", "SOY", "SEAFOOD", "SESAME"] as const;
export type Allergen = (typeof ALLERGENS)[number];

// ---------------------------------------------------------------- price resolution
export interface ResolvablePrice {
  /** "LOCATION" = set for this one branch, "BOOK" = from the branch's price book. */
  scope: "LOCATION" | "BOOK";
  channel: PriceChannel | null;
  amountMinor: number;
  compareAtMinor: number | null;
}

/**
 * Pick the price that applies for one target at one branch and channel. The input must already be limited
 * to this branch's own prices and its price book's prices. Order of preference:
 *   1. this branch + this channel   2. this branch (any channel)
 *   3. price book + this channel    4. price book (any channel)
 * No match means the item is NOT sold there (callers must not invent a price).
 */
export function resolvePrice<T extends ResolvablePrice>(rows: readonly T[], channel?: PriceChannel | null): T | null {
  const pick = (scope: ResolvablePrice["scope"], ch: PriceChannel | null) => rows.find((r) => r.scope === scope && r.channel === ch);
  return (
    (channel ? pick("LOCATION", channel) : undefined) ??
    pick("LOCATION", null) ??
    (channel ? pick("BOOK", channel) : undefined) ??
    pick("BOOK", null) ??
    null
  );
}

// ---------------------------------------------------------------- menu schedules
export interface MenuScheduleRule {
  /** 0 = Sunday .. 6 = Saturday */
  weekdays: readonly number[];
  /** "HH:MM", both null = all day. endsAt <= startsAt means the window runs past midnight. */
  startsAt: string | null;
  endsAt: string | null;
}

const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The weekday (0 = Sunday) and minutes since midnight of an instant in a branch's timezone. */
export function localTime(at: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: WEEKDAY_INDEX[get("weekday")] ?? 0, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** True if any schedule rule covers this instant in the given timezone. A menu with no rules is never served. */
export function isScheduled(rules: readonly MenuScheduleRule[], at: Date, timeZone: string): boolean {
  const { weekday, minutes } = localTime(at, timeZone);
  return rules.some((r) => {
    if (r.startsAt === null || r.endsAt === null) return r.weekdays.includes(weekday); // all day
    const start = toMinutes(r.startsAt);
    const end = toMinutes(r.endsAt);
    if (start < end) return r.weekdays.includes(weekday) && minutes >= start && minutes < end;
    // wraps past midnight: the evening part belongs to the listed day, the after-midnight part to the NEXT day
    return (r.weekdays.includes(weekday) && minutes >= start) || (r.weekdays.includes((weekday + 6) % 7) && minutes < end);
  });
}

// ---------------------------------------------------------------- availability
export interface AvailabilityState {
  isListed: boolean;
  isAvailable: boolean;
  soldOutUntil: Date | null;
}

/** "86": sold out unless the flag has lapsed. No row at all means listed and available. */
export function isSellableNow(state: AvailabilityState | null | undefined, now: Date): boolean {
  if (!state) return true;
  if (!state.isListed) return false;
  if (state.isAvailable) return true;
  return state.soldOutUntil !== null && state.soldOutUntil <= now;
}
