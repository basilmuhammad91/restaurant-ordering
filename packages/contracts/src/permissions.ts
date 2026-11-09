// THE permission catalog: the single list of "module.action" strings.
// The API checks them (requirePermission), the admin UI hides what a user cannot use, and
// roles are tenant-editable sets of them. Defining them once, here, is what stops the two
// sides drifting apart. (Laravel: like a Gate/Policy ability list, but shared with the frontend.)

export const PERMISSION_CATALOG = [
  // Dashboard
  { key: "dashboard.view", module: "Dashboard", description: "See the dashboard" },
  { key: "dashboard.financial.view", module: "Dashboard", description: "See sales and cost figures on the dashboard" },
  // Organization
  { key: "org.view", module: "Organization", description: "View brands, branches and settings" },
  { key: "org.manage", module: "Organization", description: "Edit the company profile and brands" },
  { key: "locations.manage", module: "Organization", description: "Create and edit branches, warehouses and central kitchens" },
  { key: "taxes.manage", module: "Organization", description: "Manage tax categories and profiles" },
  { key: "payment-methods.manage", module: "Organization", description: "Manage payment methods" },
  { key: "settings.manage", module: "Organization", description: "Manage tenant settings and templates" },
  // Users and access
  { key: "users.view", module: "Users & access", description: "View users" },
  { key: "users.manage", module: "Users & access", description: "Create, edit and deactivate users" },
  { key: "roles.view", module: "Users & access", description: "View roles and permissions" },
  { key: "roles.manage", module: "Users & access", description: "Edit roles, permissions and limits" },
  { key: "audit.view", module: "Users & access", description: "View the audit log" },
  { key: "approvals.view", module: "Users & access", description: "View approval requests" },
  { key: "approvals.decide", module: "Users & access", description: "Approve or reject requests (within limits)" },
  { key: "notifications.manage", module: "Users & access", description: "Manage notification settings" },
  // Menu
  { key: "menu.view", module: "Menu", description: "View the menu" },
  { key: "menu.manage", module: "Menu", description: "Edit products, modifiers and combos" },
  { key: "menu.price.edit", module: "Menu", description: "Change prices" },
  { key: "menu.availability.toggle", module: "Menu", description: "Mark items sold out (86) at a branch" },
  // Orders and POS
  { key: "pos.access", module: "Orders & POS", description: "Use the POS" },
  { key: "orders.view", module: "Orders & POS", description: "View orders" },
  { key: "orders.create", module: "Orders & POS", description: "Create orders" },
  { key: "orders.update", module: "Orders & POS", description: "Edit open orders and change status" },
  { key: "orders.cancel", module: "Orders & POS", description: "Cancel orders" },
  { key: "orders.discount", module: "Orders & POS", description: "Apply discounts (limited by the role's maximum %)" },
  { key: "orders.void", module: "Orders & POS", description: "Void order lines (limited by the role's void limit)" },
  { key: "orders.refund", module: "Orders & POS", description: "Refund payments (limited by the role's refund limit)" },
  { key: "payments.take", module: "Orders & POS", description: "Take payments" },
  { key: "kds.access", module: "Orders & POS", description: "Use the kitchen display" },
  { key: "shifts.view", module: "Orders & POS", description: "View shifts" },
  { key: "shifts.open", module: "Orders & POS", description: "Open a cash shift" },
  { key: "shifts.close", module: "Orders & POS", description: "Close a cash shift" },
  { key: "cash.manage", module: "Orders & POS", description: "Record cash in, cash out and safe drops" },
  { key: "zreport.view", module: "Orders & POS", description: "View end-of-day (Z) reports" },
  // Inventory
  { key: "inventory.view", module: "Inventory", description: "View stock" },
  { key: "items.manage", module: "Inventory", description: "Manage inventory items and units" },
  { key: "recipes.manage", module: "Inventory", description: "Manage recipes" },
  { key: "inventory.adjust", module: "Inventory", description: "Post stock adjustments (waste, expiry, ...)" },
  { key: "inventory.count", module: "Inventory", description: "Perform stock counts" },
  { key: "inventory.count.approve", module: "Inventory", description: "Approve submitted counts" },
  { key: "inventory.transfer", module: "Inventory", description: "Request and receive transfers" },
  { key: "inventory.transfer.approve", module: "Inventory", description: "Approve transfers" },
  { key: "inventory.production", module: "Inventory", description: "Run central kitchen production" },
  { key: "inventory.batches.manage", module: "Inventory", description: "Manage batches and expiry" },
  // Purchasing
  { key: "purchasing.view", module: "Purchasing", description: "View purchase orders and receipts" },
  { key: "purchasing.create", module: "Purchasing", description: "Create purchase orders" },
  { key: "purchasing.approve", module: "Purchasing", description: "Approve purchase orders (within limits)" },
  { key: "purchasing.receive", module: "Purchasing", description: "Receive goods" },
  { key: "suppliers.manage", module: "Purchasing", description: "Manage suppliers and their prices" },
  { key: "invoices.manage", module: "Purchasing", description: "Manage supplier invoices and payments" },
  // Customers and marketing
  { key: "customers.view", module: "Customers & marketing", description: "View customers" },
  { key: "customers.manage", module: "Customers & marketing", description: "Edit customers" },
  { key: "promotions.manage", module: "Customers & marketing", description: "Manage promotions" },
  { key: "coupons.manage", module: "Customers & marketing", description: "Manage coupons" },
  { key: "loyalty.manage", module: "Customers & marketing", description: "Manage loyalty rules" },
  { key: "feedback.view", module: "Customers & marketing", description: "View and answer feedback" },
  // Delivery
  { key: "delivery.view", module: "Delivery", description: "View deliveries" },
  { key: "delivery.assign", module: "Delivery", description: "Assign riders" },
  { key: "delivery.manage", module: "Delivery", description: "Manage zones and fees" },
  { key: "riders.manage", module: "Delivery", description: "Manage riders" },
  // Staff
  { key: "staff.view", module: "Staff", description: "View employees" },
  { key: "staff.manage", module: "Staff", description: "Manage employees" },
  { key: "roster.manage", module: "Staff", description: "Manage the roster" },
  { key: "timeclock.manage", module: "Staff", description: "Manage time entries" },
  // Reports
  { key: "reports.sales.view", module: "Reports", description: "Sales reports" },
  { key: "reports.cash.view", module: "Reports", description: "Cash and Z reports" },
  { key: "reports.financial.view", module: "Reports", description: "Taxes and financial reports" },
  { key: "reports.inventory.view", module: "Reports", description: "Inventory reports" },
  { key: "reports.foodcost.view", module: "Reports", description: "Food cost and variance reports" },
  { key: "reports.purchasing.view", module: "Reports", description: "Purchasing reports" },
  { key: "reports.menu.view", module: "Reports", description: "Menu engineering" },
  { key: "reports.fraud.view", module: "Reports", description: "Fraud watch" },
  { key: "reports.export", module: "Reports", description: "Export reports to CSV and PDF" },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]["key"];

export const PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key) as readonly PermissionKey[];
const KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

export const isPermissionKey = (value: string): value is PermissionKey => KEY_SET.has(value);

/** Permissions grouped by module for the matrix UI, in catalog order. */
export function permissionsByModule(): { module: string; permissions: { key: PermissionKey; description: string }[] }[] {
  const groups = new Map<string, { key: PermissionKey; description: string }[]>();
  for (const p of PERMISSION_CATALOG) {
    const list = groups.get(p.module) ?? [];
    list.push({ key: p.key, description: p.description });
    groups.set(p.module, list);
  }
  return [...groups].map(([module, permissions]) => ({ module, permissions }));
}

/** True when `granted` satisfies `required` (a user may hold the permission directly). */
export const hasPermission = (granted: ReadonlySet<string> | readonly string[], required: PermissionKey): boolean =>
  Array.isArray(granted) ? granted.includes(required) : (granted as ReadonlySet<string>).has(required);
