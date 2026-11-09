import { PERMISSION_KEYS, type PermissionKey } from "./permissions.js";

// Default roles seeded for every new tenant. After seeding they are ordinary tenant data:
// the tenant can edit them. (Laravel: like a RoleSeeder run for each new company.)

export interface DefaultRoleLimits {
  voidLimitMinor: number;
  refundLimitMinor: number;
  poApprovalLimitMinor: number;
  adjustmentLimitMinor: number;
}

export interface DefaultRole {
  name: string;
  description: string;
  isSystem: boolean;
  /** The owner role: can manage owner roles, bypasses thresholds, cannot lose roles.manage. */
  isOwner: boolean;
  /** Bypasses all amount thresholds (still audited). */
  unlimitedLimits: boolean;
  /** Highest manual discount percent this role may apply without approval. */
  maxDiscountPercent: number;
  permissions: readonly PermissionKey[];
  /** Per-currency approval limits in minor units. A missing currency means "everything needs approval". */
  limits: Record<string, DefaultRoleLimits>;
}

const REPORTS_ALL: PermissionKey[] = [
  "reports.sales.view", "reports.cash.view", "reports.financial.view", "reports.inventory.view",
  "reports.foodcost.view", "reports.purchasing.view", "reports.menu.view", "reports.fraud.view", "reports.export",
];

// Limits are illustrative defaults, in minor units (paisa, fils, cents). Tenants edit them in the UI.
const limits = (void_: [number, number, number], refund: [number, number, number], po: [number, number, number], adj: [number, number, number]) => {
  const currencies = ["PKR", "AED", "USD"] as const;
  return Object.fromEntries(
    currencies.map((c, i) => [c, { voidLimitMinor: void_[i]!, refundLimitMinor: refund[i]!, poApprovalLimitMinor: po[i]!, adjustmentLimitMinor: adj[i]! }]),
  ) as Record<string, DefaultRoleLimits>;
};

export const DEFAULT_ROLES: readonly DefaultRole[] = [
  {
    name: "Owner",
    description: "Full access to everything, including roles and other owners.",
    isSystem: true, isOwner: true, unlimitedLimits: true, maxDiscountPercent: 100,
    permissions: PERMISSION_KEYS, limits: {},
  },
  {
    name: "Head Office Admin",
    description: "Runs master data, settings and access for the whole company (cannot change owners).",
    isSystem: true, isOwner: false, unlimitedLimits: true, maxDiscountPercent: 100,
    permissions: PERMISSION_KEYS, limits: {},
  },
  {
    name: "Area Manager",
    description: "Oversees several branches: approvals, variance, cash and staffing.",
    isSystem: true, isOwner: false, unlimitedLimits: false, maxDiscountPercent: 25,
    permissions: [
      "dashboard.view", "dashboard.financial.view", "org.view", "users.view", "roles.view", "audit.view",
      "approvals.view", "approvals.decide", "menu.view", "orders.view", "orders.update", "orders.cancel",
      "orders.discount", "orders.void", "orders.refund", "shifts.view", "zreport.view", "kds.access",
      "inventory.view", "inventory.adjust", "inventory.count.approve", "inventory.transfer.approve",
      "purchasing.view", "purchasing.approve", "customers.view", "feedback.view",
      "delivery.view", "delivery.assign", "delivery.manage", "staff.view", ...REPORTS_ALL,
    ],
    limits: limits([5_000_000, 75_000, 25_000], [10_000_000, 150_000, 50_000], [250_000_000, 3_750_000, 1_000_000], [100_000_000, 1_500_000, 400_000]),
  },
  {
    name: "Branch Manager",
    description: "Runs one or more branches day to day.",
    isSystem: true, isOwner: false, unlimitedLimits: false, maxDiscountPercent: 20,
    permissions: [
      "dashboard.view", "dashboard.financial.view", "org.view", "users.view", "audit.view",
      "approvals.view", "approvals.decide", "menu.view", "menu.availability.toggle",
      "pos.access", "orders.view", "orders.create", "orders.update", "orders.cancel", "orders.discount",
      "orders.void", "orders.refund", "payments.take", "kds.access", "shifts.view", "shifts.open",
      "shifts.close", "cash.manage", "zreport.view", "inventory.view", "inventory.adjust", "inventory.count",
      "inventory.count.approve", "inventory.transfer", "inventory.transfer.approve", "purchasing.view",
      "purchasing.create", "purchasing.approve", "purchasing.receive", "customers.view", "feedback.view",
      "delivery.view", "delivery.assign", "delivery.manage", "staff.view", "staff.manage", "roster.manage",
      "timeclock.manage", "reports.sales.view", "reports.cash.view", "reports.inventory.view",
      "reports.foodcost.view", "reports.menu.view", "reports.export",
    ],
    limits: limits([1_000_000, 15_000, 5_000], [2_000_000, 30_000, 10_000], [50_000_000, 750_000, 200_000], [20_000_000, 300_000, 100_000]),
  },
  {
    name: "Cashier",
    description: "Takes orders and payments, opens and closes their own shift.",
    isSystem: true, isOwner: false, unlimitedLimits: false, maxDiscountPercent: 10,
    permissions: [
      "menu.view", "pos.access", "orders.view", "orders.create", "orders.update", "orders.discount",
      "payments.take", "shifts.view", "shifts.open", "shifts.close", "customers.view", "delivery.view",
    ],
    limits: {},
  },
  {
    name: "Kitchen Staff",
    description: "Uses the kitchen display and marks items sold out.",
    isSystem: true, isOwner: false, unlimitedLimits: false, maxDiscountPercent: 0,
    permissions: ["kds.access", "orders.view", "menu.view", "menu.availability.toggle"],
    limits: {},
  },
  {
    name: "Inventory Clerk",
    description: "Receives goods, counts stock, logs waste and transfers.",
    isSystem: true, isOwner: false, unlimitedLimits: false, maxDiscountPercent: 0,
    permissions: [
      "inventory.view", "inventory.adjust", "inventory.count", "inventory.transfer", "inventory.production",
      "purchasing.view", "purchasing.create", "purchasing.receive", "reports.inventory.view",
    ],
    limits: limits([0, 0, 0], [0, 0, 0], [0, 0, 0], [2_000_000, 30_000, 10_000]),
  },
  {
    name: "Rider",
    description: "Sees assigned deliveries.",
    isSystem: true, isOwner: false, unlimitedLimits: false, maxDiscountPercent: 0,
    permissions: ["delivery.view"],
    limits: {},
  },
] as const;

export const OWNER_ROLE_NAME = "Owner";
