import type { LimitKind } from "@restoflux/contracts";
import type { LimitSet, Principal } from "./principal.js";

// Pure threshold rules ("can this person do this, or does it need approval?"). No database, no
// framework: just functions of the principal, so they can be tested exhaustively.
// (Laravel: like Gate::define() abilities that look at an amount, kept free of Eloquent.)

export type PolicyPrincipal = Pick<Principal, "unlimitedLimits" | "maxDiscountPercent" | "limits">;

export type Decision = { allowed: true } | { allowed: false; requiresApproval: true; reason: string };

const ALLOWED: Decision = { allowed: true };

const LIMIT_FIELD: Record<LimitKind, keyof LimitSet> = {
  void: "voidLimitMinor",
  refund: "refundLimitMinor",
  purchaseOrder: "poApprovalLimitMinor",
  adjustment: "adjustmentLimitMinor",
};

/** The limit this principal has for a kind of action in a currency, or null when they have no authority there. */
export function limitFor(p: PolicyPrincipal, kind: LimitKind, currency: string): number | null {
  const row = p.limits[currency];
  return row ? row[LIMIT_FIELD[kind]] : null;
}

/**
 * An amount-based action (void, refund, PO, stock adjustment).
 * Allowed when the principal is unlimited, or the amount is within their limit for that currency.
 * No limit row for the currency means NO authority: everything needs approval (safe default).
 */
export function checkAmount(p: PolicyPrincipal, kind: LimitKind, amountMinor: number, currency: string): Decision {
  if (p.unlimitedLimits) return ALLOWED;
  const limit = limitFor(p, kind, currency);
  if (limit === null) return { allowed: false, requiresApproval: true, reason: `No ${kind} limit is set for ${currency}` };
  if (amountMinor <= limit) return ALLOWED;
  return { allowed: false, requiresApproval: true, reason: `Amount exceeds your ${kind} limit` };
}

/** A manual discount percentage (0 to 100). */
export function checkDiscount(p: PolicyPrincipal, percent: number): Decision {
  if (p.unlimitedLimits || percent <= p.maxDiscountPercent) return ALLOWED;
  return { allowed: false, requiresApproval: true, reason: `Discount exceeds your maximum of ${p.maxDiscountPercent}%` };
}
