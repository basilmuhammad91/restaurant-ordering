import { describe, expect, it } from "vitest";
import { checkAmount, checkDiscount, limitFor, type PolicyPrincipal } from "../../src/core/rbac/policy.js";

const manager: PolicyPrincipal = {
  unlimitedLimits: false,
  maxDiscountPercent: 20,
  limits: {
    PKR: { voidLimitMinor: 1_000_000, refundLimitMinor: 2_000_000, poApprovalLimitMinor: 50_000_000, adjustmentLimitMinor: 20_000_000 },
    AED: { voidLimitMinor: 15_000, refundLimitMinor: 30_000, poApprovalLimitMinor: 750_000, adjustmentLimitMinor: 300_000 },
  },
};
const owner: PolicyPrincipal = { unlimitedLimits: true, maxDiscountPercent: 100, limits: {} };
const cashier: PolicyPrincipal = { unlimitedLimits: false, maxDiscountPercent: 10, limits: {} };

describe("policy.checkAmount", () => {
  it("allows amounts up to and including the limit", () => {
    expect(checkAmount(manager, "void", 1_000_000, "PKR")).toEqual({ allowed: true });
    expect(checkAmount(manager, "void", 1, "PKR")).toEqual({ allowed: true });
    expect(checkAmount(manager, "void", 0, "PKR")).toEqual({ allowed: true });
  });

  it("requires approval one minor unit above the limit", () => {
    const d = checkAmount(manager, "void", 1_000_001, "PKR");
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.requiresApproval).toBe(true);
  });

  it("applies the limit of the right KIND", () => {
    expect(checkAmount(manager, "refund", 1_500_000, "PKR").allowed).toBe(true); // refund limit is higher
    expect(checkAmount(manager, "void", 1_500_000, "PKR").allowed).toBe(false);
    expect(checkAmount(manager, "purchaseOrder", 40_000_000, "PKR").allowed).toBe(true);
    expect(checkAmount(manager, "adjustment", 25_000_000, "PKR").allowed).toBe(false);
  });

  it("limits are per currency: the same number means different money", () => {
    expect(checkAmount(manager, "void", 900_000, "PKR").allowed).toBe(true);
    expect(checkAmount(manager, "void", 900_000, "AED").allowed).toBe(false); // AED limit is 15,000 fils
  });

  it("no limit row for a currency means no authority at all (safe default)", () => {
    const d = checkAmount(manager, "void", 1, "USD");
    expect(d.allowed).toBe(false);
    expect(limitFor(manager, "void", "USD")).toBeNull();
    expect(checkAmount(cashier, "void", 1, "PKR").allowed).toBe(false);
  });

  it("unlimited principals are always allowed, in any currency", () => {
    expect(checkAmount(owner, "refund", 2_000_000_000, "KWD").allowed).toBe(true);
  });
});

describe("policy.checkDiscount", () => {
  it("allows up to and including the maximum percent", () => {
    expect(checkDiscount(manager, 20).allowed).toBe(true);
    expect(checkDiscount(manager, 0).allowed).toBe(true);
    expect(checkDiscount(cashier, 10).allowed).toBe(true);
  });
  it("requires approval above the maximum", () => {
    expect(checkDiscount(manager, 20.01).allowed).toBe(false);
    expect(checkDiscount(cashier, 11).allowed).toBe(false);
  });
  it("a principal with no discount authority needs approval for any discount", () => {
    expect(checkDiscount({ unlimitedLimits: false, maxDiscountPercent: 0, limits: {} }, 1).allowed).toBe(false);
  });
  it("unlimited principals may apply 100%", () => {
    expect(checkDiscount(owner, 100).allowed).toBe(true);
  });
});
