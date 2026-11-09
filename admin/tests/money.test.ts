import { describe, expect, it } from "vitest";
import { formatMinor, fromMinor, toMinor } from "../src/lib/money";
import { rangeForPreset } from "../src/lib/scope-range";

describe("toMinor (string maths, never floating point)", () => {
  it("converts decimal amounts exactly", () => {
    expect(toMinor("1250.50", 2)).toBe(125050);
    expect(toMinor("0.1", 2)).toBe(10);
    expect(toMinor("0.07", 2)).toBe(7);
    expect(toMinor("19.99", 2)).toBe(1999);
    expect(toMinor("1,250", 2)).toBe(125000);
    expect(toMinor(" 5 ", 2)).toBe(500);
    expect(toMinor("0", 2)).toBe(0);
  });

  it("avoids the classic float traps", () => {
    // 1.005 * 100 = 100.49999999999999 in floating point; here more decimals than the currency allows is rejected, not rounded
    expect(toMinor("1.005", 2)).toBeNull();
    expect(toMinor("1.10", 2)).toBe(110);
    expect(toMinor("0.29", 2)).toBe(29); // 0.29 * 100 = 28.999999999999996 in floats
    expect(toMinor("1.1", 2) === 110).toBe(true);
  });

  it("respects the currency's number of decimals", () => {
    expect(toMinor("1.234", 3)).toBe(1234); // KWD
    expect(toMinor("5", 0)).toBe(5); // JPY
    expect(toMinor("5.5", 0)).toBeNull();
    expect(toMinor("5.00", 0)).toBe(5); // trailing zeros are harmless
  });

  it("rejects anything that is not a plain non-negative amount", () => {
    for (const bad of ["", "abc", "-5", "1e3", "1.2.3", "$5", ".", "--"]) expect(toMinor(bad, 2), bad).toBeNull();
    expect(toMinor("5.", 2)).toBe(500); // "5." is accepted as 5 by the pattern; documented behaviour
  });

  it("rejects amounts that do not fit the API's integer range", () => {
    expect(toMinor("20000000.01", 2)).toBeNull(); // the API maximum is 2,000,000,000 minor units (inclusive)
    expect(toMinor("20000000.00", 2)).toBe(2_000_000_000);
  });
});

describe("fromMinor / formatMinor", () => {
  it("round-trips", () => {
    expect(fromMinor(125050, 2)).toBe("1250.50");
    expect(fromMinor(7, 2)).toBe("0.07");
    expect(fromMinor(1234, 3)).toBe("1.234");
    expect(fromMinor(5, 0)).toBe("5");
    for (const n of [0, 1, 99, 100, 123456, 1_999_999_999]) expect(toMinor(fromMinor(n, 2), 2)).toBe(n);
  });

  it("formats with the currency", () => {
    expect(formatMinor(125050, "USD", 2)).toBe("$1,250.50");
    expect(formatMinor(1234, "KWD", 3)).toMatch(/1\.234/);
    expect(formatMinor(100, "NOPE", 2)).toBe("NOPE 1.00"); // unknown currency code does not crash
  });
});

describe("date range presets", () => {
  const now = new Date("2026-11-09T12:00:00");
  it("computes inclusive ranges", () => {
    expect(rangeForPreset("today", now)).toEqual({ preset: "today", from: "2026-11-09", to: "2026-11-09" });
    expect(rangeForPreset("yesterday", now)).toEqual({ preset: "yesterday", from: "2026-11-08", to: "2026-11-08" });
    expect(rangeForPreset("last7", now)).toEqual({ preset: "last7", from: "2026-11-03", to: "2026-11-09" });
    expect(rangeForPreset("last30", now)).toEqual({ preset: "last30", from: "2026-10-11", to: "2026-11-09" });
  });
  it("'this month' never extends into the future", () => {
    expect(rangeForPreset("thisMonth", now)).toEqual({ preset: "thisMonth", from: "2026-11-01", to: "2026-11-09" });
  });
});
