// ORDER MATHS: tax, discounts, rounding, change and expected cash.
// Pure integer arithmetic on MINOR units (cents, paisa, fils). No floating point is ever used for money:
// every multiplication that could produce a fraction goes through mulDivRound (BigInt), so 8.25% of
// 1999 is exactly 165 on every machine. The API uses these functions to price an order, and the POS
// uses the SAME functions to show live totals, so the screen can never disagree with the server.

export const ORDER_STATUSES = ["OPEN", "PENDING", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["UNPAID", "PARTIAL", "PAID", "REFUNDED", "PARTIALLY_REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const LINE_STATUSES = ["NEW", "PREPARING", "READY", "SERVED", "VOIDED"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

/** Where an order may go next. Anything not listed is refused (a completed order cannot go back to preparing). */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  OPEN: ["PENDING", "CONFIRMED", "CANCELLED"], // a held order is sent to the kitchen or abandoned
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"],
  OUT_FOR_DELIVERY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};
export const canTransition = (from: OrderStatus, to: OrderStatus): boolean => ORDER_TRANSITIONS[from].includes(to);

// ---------------------------------------------------------------- integer helpers
/** round-half-up(a * b / d) for non-negative integers, exact (BigInt in the middle). */
export function mulDivRound(a: number, b: number, d: number): number {
  if (d <= 0) throw new RangeError("mulDivRound: divisor must be positive");
  const n = BigInt(a) * BigInt(b);
  const bd = BigInt(d);
  return Number((n * 2n + bd) / (bd * 2n));
}

/** "8.25" or 8.25 (percent) -> 825 basis points. Rates are kept as integers, never as floats. */
export const toBasisPoints = (percent: number | string): number => Math.round(Number(percent) * 100);

/**
 * Split an amount across weights so the parts add up EXACTLY (largest remainder).
 * Used to spread an order discount over its lines: no cent is lost or invented.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const shares = weights.map((w, i) => {
    const exact = BigInt(total) * BigInt(w);
    return { i, base: Number(exact / BigInt(sum)), rest: Number(exact % BigInt(sum)) };
  });
  let left = total - shares.reduce((a, s) => a + s.base, 0);
  // hand the leftover cents to the biggest remainders (ties: earlier line first, so the result is stable)
  for (const s of [...shares].sort((x, y) => y.rest - x.rest || x.i - y.i)) {
    if (left <= 0) break;
    s.base += 1;
    left -= 1;
  }
  return shares.sort((x, y) => x.i - y.i).map((s) => s.base);
}

// ---------------------------------------------------------------- tax and totals
export interface TaxRuleInput {
  ruleId?: string | null;
  name: string;
  authorityCode: string;
  rateBp: number;
}

export interface OrderLineInput {
  key: string;
  /** Price of one unit INCLUDING its modifiers (what the customer is shown). */
  unitMinor: number;
  quantity: number;
  taxRules: readonly TaxRuleInput[];
}

export type OrderDiscountInput = { type: "PERCENT"; percentBp: number } | { type: "AMOUNT"; amountMinor: number };

export interface LineTax extends TaxRuleInput {
  baseMinor: number;
  taxMinor: number;
  isInclusive: boolean;
}

export interface PricedLine {
  key: string;
  quantity: number;
  /** unit price x quantity, before discount (gross when prices include tax) */
  subtotalMinor: number;
  discountMinor: number;
  /** Tax charged on top (exclusive) or contained in the price (inclusive). */
  taxMinor: number;
  taxLines: LineTax[];
  /** What the customer pays for this line. */
  totalMinor: number;
}

export interface PricedOrder {
  lines: PricedLine[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
}

/** Tax for ONE line. `payableMinor` is the line amount after discount; for inclusive prices it contains the tax. */
export function taxForLine(payableMinor: number, rules: readonly TaxRuleInput[], inclusive: boolean): { taxLines: LineTax[]; taxMinor: number; netMinor: number } {
  const totalBp = rules.reduce((a, r) => a + r.rateBp, 0);
  if (payableMinor <= 0 || totalBp === 0) {
    return { taxLines: rules.map((r) => ({ ...r, baseMinor: Math.max(payableMinor, 0), taxMinor: 0, isInclusive: inclusive })), taxMinor: 0, netMinor: Math.max(payableMinor, 0) };
  }
  if (!inclusive) {
    const taxLines = rules.map((r) => ({ ...r, baseMinor: payableMinor, taxMinor: mulDivRound(payableMinor, r.rateBp, 10_000), isInclusive: false }));
    return { taxLines, taxMinor: taxLines.reduce((a, t) => a + t.taxMinor, 0), netMinor: payableMinor };
  }
  // Inclusive: the price already contains the tax. net = gross / (1 + rate); the tax is gross - net, split across rules.
  const netMinor = mulDivRound(payableMinor, 10_000, 10_000 + totalBp);
  const taxMinor = payableMinor - netMinor;
  const parts = allocate(taxMinor, rules.map((r) => r.rateBp));
  return { taxLines: rules.map((r, i) => ({ ...r, baseMinor: netMinor, taxMinor: parts[i]!, isInclusive: true })), taxMinor, netMinor };
}

/**
 * Price a whole order. The order total is the SUM of its lines (no rounding drift at order level).
 * The discount comes off BEFORE tax, spread over the lines in proportion to their value.
 */
export function priceOrder(input: { lines: readonly OrderLineInput[]; pricesIncludeTax: boolean; discount?: OrderDiscountInput | null; deliveryFeeMinor?: number }): PricedOrder {
  for (const l of input.lines) {
    if (!Number.isInteger(l.unitMinor) || l.unitMinor < 0) throw new RangeError(`Line ${l.key}: price must be a whole number of minor units`);
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new RangeError(`Line ${l.key}: quantity must be at least 1`);
  }
  const subtotals = input.lines.map((l) => l.unitMinor * l.quantity);
  const subtotal = subtotals.reduce((a, b) => a + b, 0);

  let discount = 0;
  const d = input.discount;
  if (d?.type === "PERCENT") discount = mulDivRound(subtotal, d.percentBp, 10_000);
  else if (d?.type === "AMOUNT") discount = d.amountMinor;
  discount = Math.min(Math.max(discount, 0), subtotal); // never more than the order is worth
  const discounts = allocate(discount, subtotals);

  const lines: PricedLine[] = input.lines.map((l, i) => {
    const payable = subtotals[i]! - discounts[i]!;
    const { taxLines, taxMinor } = taxForLine(payable, l.taxRules, input.pricesIncludeTax);
    return {
      key: l.key, quantity: l.quantity, subtotalMinor: subtotals[i]!, discountMinor: discounts[i]!, taxMinor, taxLines,
      totalMinor: input.pricesIncludeTax ? payable : payable + taxMinor,
    };
  });

  const deliveryFeeMinor = input.deliveryFeeMinor ?? 0;
  return {
    lines, subtotalMinor: subtotal, discountMinor: discount,
    taxMinor: lines.reduce((a, l) => a + l.taxMinor, 0), deliveryFeeMinor,
    totalMinor: lines.reduce((a, l) => a + l.totalMinor, 0) + deliveryFeeMinor,
  };
}

// ---------------------------------------------------------------- payments
export interface PaymentApplication {
  /** The part of the money that settles the bill. */
  appliedMinor: number;
  changeMinor: number;
}

/**
 * Work out how much of a tender settles the bill. Cash may exceed what is owed (the extra is change);
 * every other method may not (you cannot swipe a card for more than the bill).
 */
export function applyTender(input: { dueMinor: number; tenderedMinor: number; isCash: boolean }): PaymentApplication {
  if (!Number.isInteger(input.tenderedMinor) || input.tenderedMinor <= 0) throw new RangeError("Tendered amount must be a positive whole number of minor units");
  if (input.dueMinor <= 0) throw new RangeError("Nothing is due");
  if (input.tenderedMinor <= input.dueMinor) return { appliedMinor: input.tenderedMinor, changeMinor: 0 };
  if (!input.isCash) throw new RangeError("This payment method cannot be more than the amount due");
  return { appliedMinor: input.dueMinor, changeMinor: input.tenderedMinor - input.dueMinor };
}

export function paymentStatusFor(totalMinor: number, paidMinor: number, refundedMinor: number): PaymentStatus {
  if (refundedMinor > 0 && refundedMinor >= paidMinor) return "REFUNDED";
  if (refundedMinor > 0) return "PARTIALLY_REFUNDED";
  if (paidMinor <= 0) return "UNPAID";
  return paidMinor >= totalMinor ? "PAID" : "PARTIAL";
}

// ---------------------------------------------------------------- cash drawer
export interface CashFigures {
  openingFloatMinor: number;
  cashSalesMinor: number;
  cashRefundsMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
  paidOutMinor: number;
  safeDropsMinor: number;
}

/** Cash that should be in the drawer: float + cash sales - cash refunds + cash in - cash out - paid-outs - safe drops. */
export const expectedCash = (f: CashFigures): number =>
  f.openingFloatMinor + f.cashSalesMinor - f.cashRefundsMinor + f.cashInMinor - f.cashOutMinor - f.paidOutMinor - f.safeDropsMinor;

/** Counted minus expected: negative = short, positive = over. */
export const cashVariance = (countedMinor: number, expectedMinor: number): number => countedMinor - expectedMinor;

// ---------------------------------------------------------------- business date
/**
 * The trading day an instant belongs to at a branch. A bar open until 2 am trades on yesterday's date:
 * anything before `businessDayStart` ("HH:MM", local time) counts as the previous calendar day.
 */
export function businessDateOf(at: Date, timeZone: string, businessDayStart = "05:00"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const minutes = get("hour") * 60 + get("minute");
  const startMinutes = Number(businessDayStart.slice(0, 2)) * 60 + Number(businessDayStart.slice(3, 5));
  const local = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  if (minutes < startMinutes) local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- choosing tax rules
export interface TaxRuleRow {
  ruleId: string;
  name: string;
  authorityCode: string;
  rateBp: number;
  /** null = applies to every product */
  taxCategoryId: string | null;
  /** empty = applies to every order type */
  orderTypes: readonly string[];
  validFrom: string | null;
  validTo: string | null;
}

/**
 * Which of a branch's tax rules apply to one product, for one order type, at one moment. The server and the POS
 * both call this, so the tax the screen shows is the tax the order gets.
 */
export function selectTaxRules(rules: readonly TaxRuleRow[], taxCategoryId: string | null, orderType: string, at: Date): TaxRuleInput[] {
  return rules
    .filter((r) => r.taxCategoryId === null || r.taxCategoryId === taxCategoryId)
    .filter((r) => r.orderTypes.length === 0 || r.orderTypes.includes(orderType))
    .filter((r) => (!r.validFrom || new Date(r.validFrom) <= at) && (!r.validTo || new Date(r.validTo) > at))
    .map((r) => ({ ruleId: r.ruleId, name: r.name, authorityCode: r.authorityCode, rateBp: r.rateBp }));
}
