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
      { label: "Live orders", to: "/orders/live", icon: ListChecks, anyOf: ["orders.view"] },
      { label: "POS", to: "/pos", icon: Monitor, anyOf: ["pos.access"] },
      { label: "Kitchen display", to: "/kds", icon: ChefHat, anyOf: ["kds.access"] },
      { label: "Order history", to: "/orders/history", icon: History, anyOf: ["orders.view"] },
      { label: "Shifts & cash", to: "/shifts", icon: HandCoins, anyOf: ["shifts.view"] },
      { label: "Approvals", to: "/approvals", icon: ClipboardCheck, anyOf: ["approvals.view"] },
    ],
  },
  {
    label: "Menu",
    items: [
      { label: "Products", to: "/menu/products", icon: Utensils, anyOf: ["menu.view"] },
      { label: "Categories", to: "/menu/categories", icon: Layers, anyOf: ["menu.view"] },
      { label: "Modifier groups", to: "/menu/modifiers", icon: SlidersHorizontal, anyOf: ["menu.view"] },
      { label: "Combos & deals", to: "/menu/combos", icon: Gift, anyOf: ["menu.view"] },
      { label: "Menus & dayparts", to: "/menu/menus", icon: CalendarClock, anyOf: ["menu.view"] },
      { label: "Branch availability (86)", to: "/menu/availability", icon: Soup, anyOf: ["menu.availability.toggle"] },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Stock on hand", to: "/inventory/stock", icon: Boxes, anyOf: ["inventory.view"] },
      { label: "Items", to: "/inventory/items", icon: Package, anyOf: ["inventory.view", "items.manage"] },
      { label: "Recipes", to: "/inventory/recipes", icon: BookOpen, anyOf: ["recipes.manage", "inventory.view"] },
      { label: "Counts", to: "/inventory/counts", icon: ClipboardList, anyOf: ["inventory.count"] },
      { label: "Adjustments & waste", to: "/inventory/adjustments", icon: PackageCheck, anyOf: ["inventory.adjust"] },
      { label: "Transfers", to: "/inventory/transfers", icon: Truck, anyOf: ["inventory.transfer"] },
      { label: "Production", to: "/inventory/production", icon: CookingPot, anyOf: ["inventory.production"] },
    ],
  },
  {
    label: "Purchasing",
    items: [
      { label: "Suppliers", to: "/purchasing/suppliers", icon: Store, anyOf: ["suppliers.manage", "purchasing.view"] },
      { label: "Purchase orders", to: "/purchasing/orders", icon: ShoppingCart, anyOf: ["purchasing.view"] },
      { label: "Receiving", to: "/purchasing/receiving", icon: PackageCheck, anyOf: ["purchasing.receive"] },
      { label: "Invoices & payments", to: "/purchasing/invoices", icon: Receipt, anyOf: ["invoices.manage"] },
      { label: "Suggested orders", to: "/purchasing/suggested", icon: ShoppingBasket, anyOf: ["purchasing.create"] },
    ],
  },
  {
    label: "Customers & Marketing",
    items: [
      { label: "Customers", to: "/customers", icon: Users, anyOf: ["customers.view"] },
      { label: "Promotions", to: "/marketing/promotions", icon: BadgePercent, anyOf: ["promotions.manage"] },
      { label: "Coupons", to: "/marketing/coupons", icon: Ticket, anyOf: ["coupons.manage"] },
      { label: "Loyalty", to: "/marketing/loyalty", icon: Heart, anyOf: ["loyalty.manage"] },
      { label: "Feedback", to: "/marketing/feedback", icon: MessageSquare, anyOf: ["feedback.view"] },
    ],
  },
  {
    label: "Delivery",
    items: [
      { label: "Deliveries", to: "/delivery", icon: Bike, anyOf: ["delivery.view"] },
      { label: "Riders", to: "/delivery/riders", icon: UserCog, anyOf: ["riders.manage"] },
      { label: "Zones & fees", to: "/delivery/zones", icon: MapIcon, anyOf: ["delivery.manage"] },
    ],
  },
  {
    label: "Staff",
    items: [
      { label: "Employees", to: "/staff/employees", icon: Users, anyOf: ["staff.view"] },
      { label: "Roster", to: "/staff/roster", icon: CalendarClock, anyOf: ["roster.manage", "staff.view"] },
      { label: "Time clock", to: "/staff/timeclock", icon: Clock, anyOf: ["timeclock.manage", "staff.view"] },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Sales", to: "/reports/sales", icon: BarChart3, anyOf: ["reports.sales.view"] },
      { label: "End of day / Z", to: "/reports/z", icon: FileText, anyOf: ["reports.cash.view", "zreport.view"] },
      { label: "Food cost", to: "/reports/food-cost", icon: PieChart, anyOf: ["reports.foodcost.view"] },
      { label: "Inventory", to: "/reports/inventory", icon: Boxes, anyOf: ["reports.inventory.view"] },
      { label: "Purchasing", to: "/reports/purchasing", icon: Wallet, anyOf: ["reports.purchasing.view"] },
      { label: "Menu engineering", to: "/reports/menu", icon: FileBarChart, anyOf: ["reports.menu.view"] },
      { label: "Fraud watch", to: "/reports/fraud", icon: ShieldCheck, anyOf: ["reports.fraud.view"] },
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
      { label: "Receipt templates", to: "/settings/receipts", icon: ScrollText, anyOf: ["settings.manage"] },
      { label: "Notifications", to: "/settings/notifications", icon: Settings2, anyOf: ["notifications.manage"] },
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

