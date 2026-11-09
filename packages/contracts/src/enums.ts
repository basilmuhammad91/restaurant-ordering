// Fixed vocabularies shared by API and UI. Values mirror the Prisma enums (api/prisma/schema).

export const LOCATION_TYPES = ["BRANCH", "WAREHOUSE", "CENTRAL_KITCHEN"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const PAYMENT_METHOD_TYPES = ["CASH", "CARD", "WALLET", "QR", "BANK_TRANSFER", "OTHER"] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

export const USER_STATUSES = ["ACTIVE", "INVITED", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ORDER_TYPES = ["DINE_IN", "TAKEAWAY", "DELIVERY"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const APPROVAL_TYPES = [
  "VOID", "REFUND", "DISCOUNT", "STOCK_ADJUSTMENT", "STOCK_COUNT", "TRANSFER", "PURCHASE_ORDER", "CASH_OUT",
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "CANCELLED", "CONSUMED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const REASON_TYPES = ["VOID", "REFUND", "DISCOUNT", "ADJUSTMENT", "CASH_OUT"] as const;
export type ReasonType = (typeof REASON_TYPES)[number];

export const SEVERITIES = ["INFO", "WARN", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Kinds of amount-based limits a role can hold (per currency). */
export const LIMIT_KINDS = ["void", "refund", "purchaseOrder", "adjustment"] as const;
export type LimitKind = (typeof LIMIT_KINDS)[number];

/** Currencies seeded in Phase 1 (code, name, symbol, minor-unit exponent). */
export const CURRENCIES = [
  { code: "PKR", name: "Pakistani Rupee", symbol: "Rs.", minorUnitExponent: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "AED", minorUnitExponent: 2 },
  { code: "USD", name: "US Dollar", symbol: "$", minorUnitExponent: 2 },
  { code: "SAR", name: "Saudi Riyal", symbol: "SAR", minorUnitExponent: 2 },
  { code: "QAR", name: "Qatari Riyal", symbol: "QAR", minorUnitExponent: 2 },
  { code: "KWD", name: "Kuwaiti Dinar", symbol: "KWD", minorUnitExponent: 3 },
  { code: "EUR", name: "Euro", symbol: "€", minorUnitExponent: 2 },
  { code: "GBP", name: "Pound Sterling", symbol: "£", minorUnitExponent: 2 },
] as const;
