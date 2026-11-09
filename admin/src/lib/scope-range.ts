import { endOfMonth, format, startOfMonth, subDays } from "date-fns";

// Pure date-range maths for the top-bar range picker (kept free of React so it is unit-testable).

export type RangePreset = "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "custom";

export interface DateRange {
  preset: RangePreset;
  from: string; // yyyy-MM-dd
  to: string;
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function rangeForPreset(preset: Exclude<RangePreset, "custom">, now = new Date()): DateRange {
  switch (preset) {
    case "today": return { preset, from: iso(now), to: iso(now) };
    case "yesterday": return { preset, from: iso(subDays(now, 1)), to: iso(subDays(now, 1)) };
    case "last7": return { preset, from: iso(subDays(now, 6)), to: iso(now) };
    case "last30": return { preset, from: iso(subDays(now, 29)), to: iso(now) };
    case "thisMonth": return { preset, from: iso(startOfMonth(now)), to: iso(endOfMonth(now) > now ? now : endOfMonth(now)) };
  }
}
