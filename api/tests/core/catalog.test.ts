import { isScheduled, isSellableNow, localTime, resolvePrice, type MenuScheduleRule, type ResolvablePrice } from "@restoflux/contracts";
import { describe, expect, it } from "vitest";

const p = (scope: "LOCATION" | "BOOK", channel: ResolvablePrice["channel"], amountMinor: number): ResolvablePrice => ({ scope, channel, amountMinor, compareAtMinor: null });

describe("price resolution: branch+channel, branch, book+channel, book", () => {
  const all = [p("BOOK", null, 100), p("BOOK", "WEB", 110), p("LOCATION", null, 120), p("LOCATION", "WEB", 130)];

  it("prefers the most specific price", () => {
    expect(resolvePrice(all, "WEB")?.amountMinor).toBe(130); // branch + channel
    expect(resolvePrice(all, "POS")?.amountMinor).toBe(120); // branch, any channel
    expect(resolvePrice(all)?.amountMinor).toBe(120); // no channel asked
  });

  it("falls back step by step", () => {
    const noBranchChannel = all.filter((x) => !(x.scope === "LOCATION" && x.channel === "WEB"));
    expect(resolvePrice(noBranchChannel, "WEB")?.amountMinor).toBe(120);
    const noBranch = all.filter((x) => x.scope === "BOOK");
    expect(resolvePrice(noBranch, "WEB")?.amountMinor).toBe(110); // book + channel
    expect(resolvePrice(noBranch, "POS")?.amountMinor).toBe(100); // book
  });

  it("a channel-only price is not used for other channels", () => {
    expect(resolvePrice([p("BOOK", "AGGREGATOR", 150)], "POS")).toBeNull();
    expect(resolvePrice([p("BOOK", "AGGREGATOR", 150)], "AGGREGATOR")?.amountMinor).toBe(150);
  });

  it("no price at all means the item is not sold (never an invented price)", () => {
    expect(resolvePrice([], "POS")).toBeNull();
    expect(resolvePrice([], undefined)).toBeNull();
  });

  it("a free (0) price is a real price", () => {
    expect(resolvePrice([p("BOOK", null, 0)], "POS")?.amountMinor).toBe(0);
  });

  it("the whole 2x2x channel matrix", () => {
    const channels = [null, "POS", "WEB"] as const;
    // every combination of which of the four price levels exist, for every channel asked
    for (let mask = 0; mask < 16; mask++) {
      const rows = [p("LOCATION", "WEB", 1), p("LOCATION", null, 2), p("BOOK", "WEB", 3), p("BOOK", null, 4)].filter((_, i) => mask & (1 << i));
      for (const ch of channels) {
        const expected = [...(ch === "WEB" ? [1] : []), 2, ...(ch === "WEB" ? [3] : []), 4].find((a) => rows.some((r) => r.amountMinor === a)) ?? null;
        expect(resolvePrice(rows, ch)?.amountMinor ?? null, `mask ${mask} channel ${ch}`).toBe(expected);
      }
    }
  });
});

// Monday 2026-11-09 12:30 UTC
const at = (iso: string) => new Date(iso);

describe("menu schedules (evaluated in the branch timezone)", () => {
  const weekdays = [1, 2, 3, 4, 5];
  const lunch: MenuScheduleRule = { weekdays, startsAt: "11:00", endsAt: "16:00" };

  it("converts an instant to the branch's local day and time", () => {
    expect(localTime(at("2026-11-09T12:30:00Z"), "UTC")).toEqual({ weekday: 1, minutes: 12 * 60 + 30 });
    expect(localTime(at("2026-11-09T12:30:00Z"), "Asia/Karachi")).toEqual({ weekday: 1, minutes: 17 * 60 + 30 }); // UTC+5
    expect(localTime(at("2026-11-09T22:00:00Z"), "Asia/Karachi")).toEqual({ weekday: 2, minutes: 3 * 60 }); // crosses midnight
  });

  it("serves inside the window and not outside it", () => {
    expect(isScheduled([lunch], at("2026-11-09T12:30:00Z"), "UTC")).toBe(true);
    expect(isScheduled([lunch], at("2026-11-09T16:00:00Z"), "UTC")).toBe(false); // end is exclusive
    expect(isScheduled([lunch], at("2026-11-09T11:00:00Z"), "UTC")).toBe(true); // start is inclusive
    expect(isScheduled([lunch], at("2026-11-09T10:59:00Z"), "UTC")).toBe(false);
  });

  it("the same instant can be lunch in one city and evening in another", () => {
    expect(isScheduled([lunch], at("2026-11-09T12:30:00Z"), "Asia/Karachi")).toBe(false); // 17:30 there
    expect(isScheduled([lunch], at("2026-11-09T07:00:00Z"), "Asia/Karachi")).toBe(true); // 12:00 there
  });

  it("only on the listed days", () => {
    expect(isScheduled([lunch], at("2026-11-08T12:30:00Z"), "UTC")).toBe(false); // Sunday
    expect(isScheduled([lunch], at("2026-11-14T12:30:00Z"), "UTC")).toBe(false); // Saturday
  });

  it("all day means every hour of the listed days", () => {
    const weekend: MenuScheduleRule = { weekdays: [0, 6], startsAt: null, endsAt: null };
    expect(isScheduled([weekend], at("2026-11-08T03:00:00Z"), "UTC")).toBe(true);
    expect(isScheduled([weekend], at("2026-11-09T03:00:00Z"), "UTC")).toBe(false);
  });

  it("a window past midnight belongs to the day it started on", () => {
    const late: MenuScheduleRule = { weekdays: [5], startsAt: "22:00", endsAt: "02:00" }; // Friday night
    expect(isScheduled([late], at("2026-11-13T23:00:00Z"), "UTC")).toBe(true); // Fri 23:00
    expect(isScheduled([late], at("2026-11-14T01:00:00Z"), "UTC")).toBe(true); // Sat 01:00 (still Friday's menu)
    expect(isScheduled([late], at("2026-11-14T02:00:00Z"), "UTC")).toBe(false);
    expect(isScheduled([late], at("2026-11-13T01:00:00Z"), "UTC")).toBe(false); // Fri 01:00 is Thursday's night, not listed
    expect(isScheduled([late], at("2026-11-13T21:59:00Z"), "UTC")).toBe(false);
  });

  it("any rule is enough, and no rules means never", () => {
    const breakfast: MenuScheduleRule = { weekdays, startsAt: "07:00", endsAt: "10:00" };
    expect(isScheduled([breakfast, lunch], at("2026-11-09T08:00:00Z"), "UTC")).toBe(true);
    expect(isScheduled([breakfast, lunch], at("2026-11-09T17:00:00Z"), "UTC")).toBe(false);
    expect(isScheduled([], at("2026-11-09T12:00:00Z"), "UTC")).toBe(false);
  });
});

describe("availability and the 86 flag", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  it("no row means available", () => expect(isSellableNow(null, now)).toBe(true));
  it("unlisted items are never sold there", () => expect(isSellableNow({ isListed: false, isAvailable: true, soldOutUntil: null }, now)).toBe(false));
  it("86 blocks the item", () => expect(isSellableNow({ isListed: true, isAvailable: false, soldOutUntil: null }, now)).toBe(false));
  it("86 with a timer lapses on its own", () => {
    expect(isSellableNow({ isListed: true, isAvailable: false, soldOutUntil: new Date("2026-11-09T13:00:00Z") }, now)).toBe(false);
    expect(isSellableNow({ isListed: true, isAvailable: false, soldOutUntil: new Date("2026-11-09T12:00:00Z") }, now)).toBe(true);
  });
});
