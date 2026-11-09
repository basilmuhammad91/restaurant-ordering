import type { PermissionKey } from "@restoflux/contracts";
import {
  BadgePercent, BarChart3, Bike, BookOpen, Boxes, Building2, CalendarClock, ChefHat, ClipboardCheck, ClipboardList, Clock, CookingPot,
  FileBarChart, FileText, Gift, HandCoins, Heart, History, KeyRound, LayoutDashboard, Palette, Layers, ListChecks, Map as MapIcon, MessageSquare, Monitor,
  Package, PackageCheck, PieChart, Receipt, ScrollText, Settings2, ShieldCheck, ShoppingBasket, ShoppingCart, SlidersHorizontal,
  Soup, Store, Tags, Ticket, Truck, Users, UserCog, Utensils, Wallet, Warehouse, type LucideIcon,
} from "lucide-react";
import { canAny, type PermissionSet } from "../lib/permissions";

// The sidebar, declared once. Each item lists the permissions that reveal it (any one of them);
// groups with no visible items disappear. Items marked `soon` belong to modules built in later phases:
// they show in the navigation (so the whole product map is visible) but open a "coming soon" page.

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Shown if the user holds at least one of these. Omit for "everyone who is logged in". */
  anyOf?: PermissionKey[];
  /** Module not built yet (later phase). */
  soon?: boolean;
  /** Match the path exactly (for "/"). */
  end?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", to: "/", icon: LayoutDashboard, anyOf: ["dashboard.view"], end: true }],
  },
  {
    label: "Sales & Orders",
    items: [
      { label: "Live orders", to: "/orders/live", icon: ListChecks, anyOf: ["orders.view"], soon: true },
      { label: "POS", to: "/pos", icon: Monitor, anyOf: ["pos.access"], soon: true },
      { label: "Kitchen display", to: "/kds", icon: ChefHat, anyOf: ["kds.access"], soon: true },
      { label: "Order history", to: "/orders/history", icon: History, anyOf: ["orders.view"], soon: true },
      { label: "Shifts & cash", to: "/shifts", icon: HandCoins, anyOf: ["shifts.view"], soon: true },
      { label: "Approvals", to: "/approvals", icon: ClipboardCheck, anyOf: ["approvals.view"] },
    ],
  },
  {
    label: "Menu",
    items: [
      { label: "Products", to: "/menu/products", icon: Utensils, anyOf: ["menu.view"], soon: true },
      { label: "Categories", to: "/menu/categories", icon: Layers, anyOf: ["menu.view"], soon: true },
      { label: "Modifier groups", to: "/menu/modifiers", icon: SlidersHorizontal, anyOf: ["menu.view"], soon: true },
      { label: "Combos & deals", to: "/menu/combos", icon: Gift, anyOf: ["menu.view"], soon: true },
      { label: "Menus & dayparts", to: "/menu/menus", icon: CalendarClock, anyOf: ["menu.view"], soon: true },
      { label: "Branch availability (86)", to: "/menu/availability", icon: Soup, anyOf: ["menu.availability.toggle"], soon: true },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Stock on hand", to: "/inventory/stock", icon: Boxes, anyOf: ["inventory.view"], soon: true },
      { label: "Items", to: "/inventory/items", icon: Package, anyOf: ["inventory.view", "items.manage"], soon: true },
      { label: "Recipes", to: "/inventory/recipes", icon: BookOpen, anyOf: ["recipes.manage", "inventory.view"], soon: true },
      { label: "Counts", to: "/inventory/counts", icon: ClipboardList, anyOf: ["inventory.count"], soon: true },
      { label: "Adjustments & waste", to: "/inventory/adjustments", icon: PackageCheck, anyOf: ["inventory.adjust"], soon: true },
      { label: "Transfers", to: "/inventory/transfers", icon: Truck, anyOf: ["inventory.transfer"], soon: true },
      { label: "Production", to: "/inventory/production", icon: CookingPot, anyOf: ["inventory.production"], soon: true },
    ],
  },
  {
    label: "Purchasing",
    items: [
      { label: "Suppliers", to: "/purchasing/suppliers", icon: Store, anyOf: ["suppliers.manage", "purchasing.view"], soon: true },
      { label: "Purchase orders", to: "/purchasing/orders", icon: ShoppingCart, anyOf: ["purchasing.view"], soon: true },
      { label: "Receiving", to: "/purchasing/receiving", icon: PackageCheck, anyOf: ["purchasing.receive"], soon: true },
      { label: "Invoices & payments", to: "/purchasing/invoices", icon: Receipt, anyOf: ["invoices.manage"], soon: true },
      { label: "Suggested orders", to: "/purchasing/suggested", icon: ShoppingBasket, anyOf: ["purchasing.create"], soon: true },
    ],
  },
  {
    label: "Customers & Marketing",
    items: [
      { label: "Customers", to: "/customers", icon: Users, anyOf: ["customers.view"], soon: true },
      { label: "Promotions", to: "/marketing/promotions", icon: BadgePercent, anyOf: ["promotions.manage"], soon: true },
      { label: "Coupons", to: "/marketing/coupons", icon: Ticket, anyOf: ["coupons.manage"], soon: true },
      { label: "Loyalty", to: "/marketing/loyalty", icon: Heart, anyOf: ["loyalty.manage"], soon: true },
      { label: "Feedback", to: "/marketing/feedback", icon: MessageSquare, anyOf: ["feedback.view"], soon: true },
    ],
  },
  {
    label: "Delivery",
    items: [
      { label: "Deliveries", to: "/delivery", icon: Bike, anyOf: ["delivery.view"], soon: true },
      { label: "Riders", to: "/delivery/riders", icon: UserCog, anyOf: ["riders.manage"], soon: true },
      { label: "Zones & fees", to: "/delivery/zones", icon: MapIcon, anyOf: ["delivery.manage"], soon: true },
    ],
  },
  {
    label: "Staff",
    items: [
      { label: "Employees", to: "/staff/employees", icon: Users, anyOf: ["staff.view"], soon: true },
      { label: "Roster", to: "/staff/roster", icon: CalendarClock, anyOf: ["roster.manage", "staff.view"], soon: true },
      { label: "Time clock", to: "/staff/timeclock", icon: Clock, anyOf: ["timeclock.manage", "staff.view"], soon: true },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Sales", to: "/reports/sales", icon: BarChart3, anyOf: ["reports.sales.view"], soon: true },
      { label: "End of day / Z", to: "/reports/z", icon: FileText, anyOf: ["reports.cash.view", "zreport.view"], soon: true },
      { label: "Food cost", to: "/reports/food-cost", icon: PieChart, anyOf: ["reports.foodcost.view"], soon: true },
      { label: "Inventory", to: "/reports/inventory", icon: Boxes, anyOf: ["reports.inventory.view"], soon: true },
      { label: "Purchasing", to: "/reports/purchasing", icon: Wallet, anyOf: ["reports.purchasing.view"], soon: true },
      { label: "Menu engineering", to: "/reports/menu", icon: FileBarChart, anyOf: ["reports.menu.view"], soon: true },
      { label: "Fraud watch", to: "/reports/fraud", icon: ShieldCheck, anyOf: ["reports.fraud.view"], soon: true },
    ],
  },
  {
    label: "Organization",
    items: [
      { label: "Brands", to: "/org/brands", icon: Building2, anyOf: ["org.view"] },
      { label: "Branches & warehouses", to: "/org/locations", icon: Warehouse, anyOf: ["org.view"] },
      { label: "Tax profiles", to: "/org/taxes", icon: Receipt, anyOf: ["org.view", "taxes.manage"] },
      { label: "Payment methods", to: "/org/payment-methods", icon: Wallet, anyOf: ["org.view", "payment-methods.manage"] },
      { label: "Price books", to: "/org/price-books", icon: Tags, anyOf: ["org.view"] },
      { label: "Tables & stations", to: "/org/tables", icon: Utensils, anyOf: ["org.view"] },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Organization & appearance", to: "/settings/organization", icon: Palette, anyOf: ["org.view"] },
      { label: "Users", to: "/settings/users", icon: Users, anyOf: ["users.view"] },
      { label: "Roles & permissions", to: "/settings/roles", icon: KeyRound, anyOf: ["roles.view"] },
      { label: "Receipt templates", to: "/settings/receipts", icon: ScrollText, anyOf: ["settings.manage"], soon: true },
      { label: "Notifications", to: "/settings/notifications", icon: Settings2, anyOf: ["notifications.manage"], soon: true },
      { label: "Audit log", to: "/settings/audit", icon: ShieldCheck, anyOf: ["audit.view"] },
    ],
  },
];

/** The navigation this user is allowed to see: items filtered by permission, empty groups removed. */
export function visibleNav(permissions: PermissionSet, groups: NavGroup[] = NAV): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => canAny(permissions, i.anyOf)) }))
    .filter((g) => g.items.length > 0);
}

/** All items flattened, for the command palette and the "coming soon" page lookup. */
export const allNavItems = (groups: NavGroup[] = NAV): (NavItem & { group: string })[] => groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));

