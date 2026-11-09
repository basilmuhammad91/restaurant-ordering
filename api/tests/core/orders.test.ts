import {
  allocate, applyTender, businessDateOf, canTransition, cashVariance, expectedCash, mulDivRound, ORDER_STATUSES, ORDER_TRANSITIONS, paymentStatusFor,
  priceOrder, taxForLine, toBasisPoints, type OrderLineInput, type TaxRuleInput,
} from "@restoflux/contracts";
import { describe, expect, it } from "vitest";

const rule = (rateBp: number, name = "Tax", authorityCode = "TAX"): TaxRuleInput => ({ name, authorityCode, rateBp });
const line = (key: string, unitMinor: number, quantity = 1, taxRules: TaxRuleInput[] = []): OrderLineInput => ({ key, unitMinor, quantity, taxRules });

describe("rounding helpers", () => {
  it("mulDivRound rounds half up and never goes through floating point", () => {
    expect(mulDivRound(1999, 825, 10_000)).toBe(165); // 164.9175 -> 165
    expect(mulDivRound(1000, 825, 10_000)).toBe(83); // 82.5 -> 83 (half up)
    expect(mulDivRound(10, 5, 100)).toBe(1); // 0.5 -> 1
    expect(mulDivRound(9, 5, 100)).toBe(0); // 0.45 -> 0
    expect(mulDivRound(2_000_000_000, 10_000, 10_000)).toBe(2_000_000_000); // would overflow a float-based approach at scale
    expect(() => mulDivRound(1, 1, 0)).toThrow();
  });

  it("converts percentages to basis points without float error", () => {
    expect(toBasisPoints("8.25")).toBe(825);
    expect(toBasisPoints(13)).toBe(1300);
    expect(toBasisPoints("16.000")).toBe(1600);
    expect(toBasisPoints(0.1 + 0.2)).toBe(30); // 0.30000000000000004 -> 30
  });

  it("allocate splits exactly: no cent lost or invented", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [3, 3, 4])).toEqual([3, 3, 4]);
    expect(allocate(1, [5, 5])).toEqual([1, 0]); // a single cent goes to one line, deterministically
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(50, [0, 0])).toEqual([0, 0]);
    expect(allocate(50, [])).toEqual([]);
  });

  it("allocate always sums to the total, for many shapes (property check)", () => {
    let seed = 12345;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let t = 0; t < 400; t++) {
      const weights = Array.from({ length: 1 + rnd(8) }, () => rnd(5000));
      const total = rnd(100_000);
      const parts = allocate(total, weights);
      const weightSum = weights.reduce((a, b) => a + b, 0);
      expect(parts.reduce((a, b) => a + b, 0), `weights ${weights} total ${total}`).toBe(weightSum > 0 ? total : 0);
      expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
    }
  });
});

describe("tax on one line", () => {
  it("exclusive: tax is added on top, rounded half up per rule", () => {
    const r = taxForLine(10_000, [rule(1300, "SRB", "SRB")], false);
    expect(r.taxMinor).toBe(1300);
    expect(r.netMinor).toBe(10_000);
    expect(r.taxLines[0]).toMatchObject({ authorityCode: "SRB", baseMinor: 10_000, taxMinor: 1300, isInclusive: false });
  });

  it("exclusive with two authorities stores each separately", () => {
    const r = taxForLine(10_000, [rule(500, "VAT", "FTA"), rule(1000, "Service", "SVC")], false);
    expect(r.taxLines.map((t) => t.taxMinor)).toEqual([500, 1000]);
    expect(r.taxMinor).toBe(1500);
  });

  it("inclusive: the price already contains the tax (UAE VAT 5%)", () => {
    const r = taxForLine(10_500, [rule(500, "VAT", "FTA")], true);
    expect(r.netMinor).toBe(10_000);
    expect(r.taxMinor).toBe(500);
    expect(r.taxLines[0]).toMatchObject({ baseMinor: 10_000, taxMinor: 500, isInclusive: true });
  });

  it("inclusive: net + tax always equals the price paid, whatever the rounding", () => {
    for (const gross of [1, 99, 100, 101, 999, 1999, 12_345, 99_999]) {
      for (const bp of [500, 825, 1300, 1600]) {
        const r = taxForLine(gross, [rule(bp)], true);
        expect(r.netMinor + r.taxMinor, `gross ${gross} @ ${bp}`).toBe(gross);
      }
    }
  });

  it("inclusive with two rules splits the extracted tax so the parts sum exactly", () => {
    const r = taxForLine(11_500, [rule(500, "A"), rule(1000, "B")], true);
    expect(r.taxLines.reduce((a, t) => a + t.taxMinor, 0)).toBe(r.taxMinor);
    expect(r.netMinor + r.taxMinor).toBe(11_500);
  });

  it("zero rate, zero amount and no rules give zero tax", () => {
    expect(taxForLine(5000, [rule(0)], false).taxMinor).toBe(0);
    expect(taxForLine(0, [rule(1300)], false).taxMinor).toBe(0);
    expect(taxForLine(5000, [], true).taxMinor).toBe(0);
  });
});

describe("pricing an order", () => {
  it("exclusive tax: total = subtotal - discount + tax + delivery", () => {
    const o = priceOrder({ lines: [line("a", 89_000, 2, [rule(1300)]), line("b", 29_000, 1, [rule(1300)])], pricesIncludeTax: false, deliveryFeeMinor: 15_000 });
    expect(o.subtotalMinor).toBe(207_000);
    expect(o.taxMinor).toBe(26_910); // 13% of 207,000
    expect(o.totalMinor).toBe(207_000 + 26_910 + 15_000);
  });

  it("inclusive tax: the total is just the subtotal (tax is inside)", () => {
    const o = priceOrder({ lines: [line("a", 10_500, 1, [rule(500)])], pricesIncludeTax: true });
    expect(o.totalMinor).toBe(10_500);
    expect(o.taxMinor).toBe(500);
  });

  it("the order total is the SUM of the lines (no order-level rounding drift)", () => {
    // three lines whose individual tax roundings differ from rounding the whole order once
    const lines = [line("a", 333, 1, [rule(825)]), line("b", 333, 1, [rule(825)]), line("c", 333, 1, [rule(825)])];
    const o = priceOrder({ lines, pricesIncludeTax: false });
    expect(o.totalMinor).toBe(o.lines.reduce((a, l) => a + l.totalMinor, 0));
    expect(o.taxMinor).toBe(o.lines.reduce((a, l) => a + l.taxMinor, 0));
    expect(o.taxMinor).toBe(3 * mulDivRound(333, 825, 10_000)); // each line rounded on its own
  });

  it("a percent discount comes off BEFORE tax and is spread over the lines", () => {
    const o = priceOrder({ lines: [line("a", 10_000, 1, [rule(1000)]), line("b", 30_000, 1, [rule(1000)])], pricesIncludeTax: false, discount: { type: "PERCENT", percentBp: 1000 } });
    expect(o.discountMinor).toBe(4000); // 10% of 40,000
    expect(o.lines.map((l) => l.discountMinor)).toEqual([1000, 3000]);
    expect(o.taxMinor).toBe(3600); // 10% tax on the discounted 36,000, not on 40,000
    expect(o.totalMinor).toBe(36_000 + 3600);
  });

  it("an amount discount is spread by value and the parts add up exactly", () => {
    const o = priceOrder({ lines: [line("a", 100, 1), line("b", 100, 1), line("c", 100, 1)], pricesIncludeTax: false, discount: { type: "AMOUNT", amountMinor: 100 } });
    expect(o.lines.reduce((a, l) => a + l.discountMinor, 0)).toBe(100);
    expect(o.lines.map((l) => l.discountMinor)).toEqual([34, 33, 33]);
  });

  it("a discount can never exceed the order, and never goes negative", () => {
    const big = priceOrder({ lines: [line("a", 5000)], pricesIncludeTax: false, discount: { type: "AMOUNT", amountMinor: 999_999 } });
    expect(big.discountMinor).toBe(5000);
    expect(big.totalMinor).toBe(0);
    const negative = priceOrder({ lines: [line("a", 5000)], pricesIncludeTax: false, discount: { type: "AMOUNT", amountMinor: -50 } });
    expect(negative.discountMinor).toBe(0);
  });

  it("discount with inclusive tax reduces the tax contained in the price", () => {
    const o = priceOrder({ lines: [line("a", 10_500, 1, [rule(500)])], pricesIncludeTax: true, discount: { type: "PERCENT", percentBp: 1000 } });
    expect(o.totalMinor).toBe(9450);
    expect(o.taxMinor).toBe(450); // 5% inside 9,450
  });

  it("quantities multiply the unit price (modifiers are part of the unit price)", () => {
    const o = priceOrder({ lines: [line("a", 89_000 + 8000 + 15_000, 3)], pricesIncludeTax: false });
    expect(o.subtotalMinor).toBe(112_000 * 3);
  });

  it("different tax rules per line (a drink taxed differently from food)", () => {
    const o = priceOrder({ lines: [line("food", 10_000, 1, [rule(1300)]), line("water", 10_000, 1, [])], pricesIncludeTax: false });
    expect(o.lines.map((l) => l.taxMinor)).toEqual([1300, 0]);
  });

  it("rejects fractional money and impossible quantities", () => {
    expect(() => priceOrder({ lines: [line("a", 10.5)], pricesIncludeTax: false })).toThrow(RangeError);
    expect(() => priceOrder({ lines: [line("a", 100, 0)], pricesIncludeTax: false })).toThrow(RangeError);
    expect(() => priceOrder({ lines: [line("a", 100, 1.5)], pricesIncludeTax: false })).toThrow(RangeError);
    expect(() => priceOrder({ lines: [line("a", -1)], pricesIncludeTax: false })).toThrow(RangeError);
  });

  it("an empty order is worth nothing", () => {
    const o = priceOrder({ lines: [], pricesIncludeTax: false });
    expect(o.totalMinor).toBe(0);
  });

  it("invariants hold for hundreds of random orders (property check)", () => {
    let seed = 987;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let t = 0; t < 300; t++) {
      const inclusive = rnd(2) === 1;
      const lines = Array.from({ length: 1 + rnd(6) }, (_, i) => line(`l${i}`, rnd(50_000), 1 + rnd(4), rnd(3) === 0 ? [] : [rule(rnd(2000), "R1"), ...(rnd(2) ? [rule(rnd(1500), "R2")] : [])]));
      const discount = rnd(3) === 0 ? ({ type: "PERCENT", percentBp: rnd(10_001) } as const) : rnd(3) === 0 ? ({ type: "AMOUNT", amountMinor: rnd(60_000) } as const) : null;
      const delivery = rnd(2) * rnd(20_000);
      const o = priceOrder({ lines, pricesIncludeTax: inclusive, discount, deliveryFeeMinor: delivery });

      expect(o.lines.reduce((a, l) => a + l.discountMinor, 0), "discount spread").toBe(o.discountMinor);
      expect(o.lines.reduce((a, l) => a + l.totalMinor, 0) + delivery, "total is the sum of lines").toBe(o.totalMinor);
      expect(o.lines.reduce((a, l) => a + l.taxMinor, 0), "tax is the sum of lines").toBe(o.taxMinor);
      for (const l of o.lines) {
        expect(l.taxLines.reduce((a, x) => a + x.taxMinor, 0), "line tax is the sum of its authorities").toBe(l.taxMinor);
        expect(l.totalMinor).toBeGreaterThanOrEqual(0);
        if (inclusive) expect(l.totalMinor).toBe(l.subtotalMinor - l.discountMinor);
        else expect(l.totalMinor).toBe(l.subtotalMinor - l.discountMinor + l.taxMinor);
      }
      expect(o.discountMinor).toBeLessThanOrEqual(o.subtotalMinor);
    }
  });
});

describe("taking payment", () => {
  it("exact and partial tenders settle exactly what was given", () => {
    expect(applyTender({ dueMinor: 5000, tenderedMinor: 5000, isCash: false })).toEqual({ appliedMinor: 5000, changeMinor: 0 });
    expect(applyTender({ dueMinor: 5000, tenderedMinor: 2000, isCash: true })).toEqual({ appliedMinor: 2000, changeMinor: 0 });
  });

  it("cash over the amount due gives change", () => {
    expect(applyTender({ dueMinor: 87_300, tenderedMinor: 100_000, isCash: true })).toEqual({ appliedMinor: 87_300, changeMinor: 12_700 });
  });

  it("a card cannot be charged more than is due", () => {
    expect(() => applyTender({ dueMinor: 5000, tenderedMinor: 5001, isCash: false })).toThrow(RangeError);
  });

  it("rejects zero, negative and fractional tenders, and paying nothing due", () => {
    for (const t of [0, -5, 10.5]) expect(() => applyTender({ dueMinor: 5000, tenderedMinor: t, isCash: true })).toThrow(RangeError);
    expect(() => applyTender({ dueMinor: 0, tenderedMinor: 100, isCash: true })).toThrow(RangeError);
  });

  it("split payment: cash then card settles the bill with change only on the cash part", () => {
    const first = applyTender({ dueMinor: 10_000, tenderedMinor: 4000, isCash: true });
    const second = applyTender({ dueMinor: 10_000 - first.appliedMinor, tenderedMinor: 6000, isCash: false });
    expect(first.appliedMinor + second.appliedMinor).toBe(10_000);
    expect(first.changeMinor + second.changeMinor).toBe(0);
  });

  it("payment status follows the money", () => {
    expect(paymentStatusFor(10_000, 0, 0)).toBe("UNPAID");
    expect(paymentStatusFor(10_000, 4000, 0)).toBe("PARTIAL");
    expect(paymentStatusFor(10_000, 10_000, 0)).toBe("PAID");
    expect(paymentStatusFor(10_000, 10_000, 3000)).toBe("PARTIALLY_REFUNDED");
    expect(paymentStatusFor(10_000, 10_000, 10_000)).toBe("REFUNDED");
  });
});

describe("order status machine", () => {
  it("allows the normal journey and rejects shortcuts", () => {
    expect(canTransition("PENDING", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "PREPARING")).toBe(true);
    expect(canTransition("PREPARING", "READY")).toBe(true);
    expect(canTransition("READY", "COMPLETED")).toBe(true);
    expect(canTransition("PENDING", "COMPLETED")).toBe(false);
    expect(canTransition("PREPARING", "PENDING")).toBe(false);
  });

  it("completed and cancelled orders are final", () => {
    for (const to of ORDER_STATUSES) {
      expect(canTransition("COMPLETED", to)).toBe(false);
      expect(canTransition("CANCELLED", to)).toBe(false);
    }
  });

  it("everything except final states can be cancelled", () => {
    for (const s of ORDER_STATUSES.filter((x) => x !== "COMPLETED" && x !== "CANCELLED")) expect(canTransition(s, "CANCELLED"), s).toBe(true);
    expect(Object.keys(ORDER_TRANSITIONS)).toHaveLength(ORDER_STATUSES.length);
  });
});

describe("cash drawer", () => {
  const base = { openingFloatMinor: 500_000, cashSalesMinor: 0, cashRefundsMinor: 0, cashInMinor: 0, cashOutMinor: 0, paidOutMinor: 0, safeDropsMinor: 0 };

  it("expected cash = float + cash sales - refunds + in - out - paid-outs - safe drops", () => {
    expect(expectedCash(base)).toBe(500_000);
    expect(expectedCash({ ...base, cashSalesMinor: 1_200_000, cashRefundsMinor: 50_000, cashInMinor: 20_000, cashOutMinor: 10_000, paidOutMinor: 80_000, safeDropsMinor: 1_000_000 })).toBe(500_000 + 1_200_000 - 50_000 + 20_000 - 10_000 - 80_000 - 1_000_000);
  });

  it("variance is counted minus expected (negative = short)", () => {
    expect(cashVariance(498_000, 500_000)).toBe(-2000);
    expect(cashVariance(500_000, 500_000)).toBe(0);
    expect(cashVariance(503_500, 500_000)).toBe(3500);
  });
});

describe("business date", () => {
  it("a bar open past midnight trades on the previous date until the day starts", () => {
    // 2026-11-10 01:30 in Karachi (UTC+5) is 2026-11-09 20:30Z
    expect(businessDateOf(new Date("2026-11-09T20:30:00Z"), "Asia/Karachi", "05:00")).toBe("2026-11-09");
    expect(businessDateOf(new Date("2026-11-10T00:30:00Z"), "Asia/Karachi", "05:00")).toBe("2026-11-10"); // 05:30 local: new day
    expect(businessDateOf(new Date("2026-11-09T23:59:00Z"), "Asia/Karachi", "05:00")).toBe("2026-11-09"); // 04:59 local: still yesterday
  });

  it("uses the branch's own timezone, not the server's", () => {
    const at = new Date("2026-11-09T22:00:00Z");
    expect(businessDateOf(at, "Asia/Karachi", "00:00")).toBe("2026-11-10"); // 03:00 on the 10th
    expect(businessDateOf(at, "America/Chicago", "00:00")).toBe("2026-11-09"); // 16:00 on the 9th
  });
});
