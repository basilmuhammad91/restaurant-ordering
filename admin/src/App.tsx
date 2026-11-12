import { Navigate, Outlet, Route, Routes } from "react-router";
import { RequireAuth, RequirePermission } from "@/app/guards";
import { AppShell } from "@/app/shell/AppShell";
import { PlatformShell } from "@/app/shell/PlatformShell";
import ApprovalsPage from "@/features/approvals/ApprovalsPage";
import LoginPage from "@/features/auth/LoginPage";
import { ComingSoonPage, WelcomePage } from "@/features/common/CommonPages";
import DashboardPage from "@/features/dashboard/DashboardPage";
import AdjustmentsPage from "@/features/inventory/AdjustmentsPage";
import CountsPage from "@/features/inventory/CountsPage";
import InventoryItemsPage from "@/features/inventory/ItemsPage";
import ProductionPage from "@/features/inventory/ProductionPage";
import RecipesPage from "@/features/inventory/RecipesPage";
import StockPage from "@/features/inventory/StockPage";
import TransfersPage from "@/features/inventory/TransfersPage";
import FoodCostPage from "@/features/reports/FoodCostPage";
import FraudPage from "@/features/reports/FraudPage";
import InventoryReportPage from "@/features/reports/InventoryReportPage";
import MenuEngineeringPage from "@/features/reports/MenuEngineeringPage";
import PurchasingReportPage from "@/features/reports/PurchasingReportPage";
import SalesReportPage from "@/features/reports/SalesReportPage";
import ZReportsPage from "@/features/reports/ZReportsPage";
import InvoicesPage from "@/features/purchasing/InvoicesPage";
import PurchaseOrdersPage from "@/features/purchasing/PurchaseOrdersPage";
import ReceivingPage from "@/features/purchasing/ReceivingPage";
import SuggestedPage from "@/features/purchasing/SuggestedPage";
import SuppliersPage from "@/features/purchasing/SuppliersPage";
import CouponsPage from "@/features/marketing/CouponsPage";
import CustomersPage from "@/features/marketing/CustomersPage";
import FeedbackPage from "@/features/marketing/FeedbackPage";
import LoyaltyPage from "@/features/marketing/LoyaltyPage";
import PromotionsPage from "@/features/marketing/PromotionsPage";
import DeliveriesPage from "@/features/delivery/DeliveriesPage";
import RidersPage from "@/features/delivery/RidersPage";
import ZonesPage from "@/features/delivery/ZonesPage";
import EmployeesPage from "@/features/staff/EmployeesPage";
import RosterPage from "@/features/staff/RosterPage";
import TimeClockPage from "@/features/staff/TimeClockPage";
import NotificationSettingsPage from "@/features/settings/NotificationSettingsPage";
import ReceiptTemplatePage from "@/features/settings/ReceiptTemplatePage";
import BrandsPage from "@/features/org/BrandsPage";
import LocationsPage from "@/features/org/LocationsPage";
import PaymentMethodsPage from "@/features/org/PaymentMethodsPage";
import PriceBooksPage from "@/features/org/PriceBooksPage";
import TablesPage from "@/features/org/TablesPage";
import TaxesPage from "@/features/org/TaxesPage";
import KitchenPage from "@/features/orders/KitchenPage";
import LiveOrdersPage from "@/features/orders/LiveOrdersPage";
import OrderHistoryPage from "@/features/orders/OrderHistoryPage";
import ShiftsPage from "@/features/orders/ShiftsPage";
import PosPage from "@/features/pos/PosPage";
import AvailabilityPage from "@/features/menu/AvailabilityPage";
import CategoriesPage from "@/features/menu/CategoriesPage";
import CombosPage from "@/features/menu/CombosPage";
import MenusPage from "@/features/menu/MenusPage";
import ModifierGroupsPage from "@/features/menu/ModifierGroupsPage";
import ProductsPage from "@/features/menu/ProductsPage";
import AuditLogPage from "@/features/settings/AuditLogPage";
import OrganizationSettingsPage from "@/features/settings/OrganizationSettingsPage";
import RoleMatrixPage from "@/features/settings/RoleMatrixPage";
import RolesPage from "@/features/settings/RolesPage";
import UsersPage from "@/features/settings/UsersPage";
import { useAuth } from "@/lib/auth";
import { PlatformAuthProvider } from "@/lib/platform";
import OrganizationDetailPage from "@/features/platform/OrganizationDetailPage";
import OrganizationsPage from "@/features/platform/OrganizationsPage";
import PlatformAuditPage from "@/features/platform/PlatformAuditPage";
import PlatformLoginPage from "@/features/platform/PlatformLoginPage";
import PlatformTeamPage from "@/features/platform/PlatformTeamPage";

// Route table. Each group of pages sits behind a permission guard (the API enforces the same rules).
export default function App() {
  const { can } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* The Restoflux team console: separate sign-in, separate token, never mixed with restaurant staff. */}
      <Route path="/platform" element={<PlatformAuthProvider><Outlet /></PlatformAuthProvider>}>
        <Route path="login" element={<PlatformLoginPage />} />
        <Route element={<PlatformShell />}>
          <Route index element={<Navigate to="organizations" replace />} />
          <Route path="organizations" element={<OrganizationsPage />} />
          <Route path="organizations/:id" element={<OrganizationDetailPage />} />
          <Route path="audit" element={<PlatformAuditPage />} />
          <Route path="team" element={<PlatformTeamPage />} />
        </Route>
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<RequirePermission anyOf={["pos.access"]} />}>
          <Route path="pos" element={<PosPage />} />
        </Route>
        <Route element={<AppShell />}>
          <Route index element={can("dashboard.view") ? <DashboardPage /> : <WelcomePage />} />

          <Route element={<RequirePermission anyOf={["approvals.view"]} />}>
            <Route path="approvals" element={<ApprovalsPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={["orders.view"]} />}>
            <Route path="orders/live" element={<LiveOrdersPage />} />
            <Route path="orders/history" element={<OrderHistoryPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["kds.access"]} />}>
            <Route path="kds" element={<KitchenPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["shifts.view"]} />}>
            <Route path="shifts" element={<ShiftsPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={["inventory.view"]} />}>
            <Route path="inventory/stock" element={<StockPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["inventory.view", "items.manage"]} />}>
            <Route path="inventory/items" element={<InventoryItemsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["recipes.manage", "inventory.view"]} />}>
            <Route path="inventory/recipes" element={<RecipesPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["inventory.count"]} />}>
            <Route path="inventory/counts" element={<CountsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["inventory.adjust"]} />}>
            <Route path="inventory/adjustments" element={<AdjustmentsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["inventory.transfer"]} />}>
            <Route path="inventory/transfers" element={<TransfersPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["inventory.production"]} />}>
            <Route path="inventory/production" element={<ProductionPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={["suppliers.manage", "purchasing.view"]} />}>
            <Route path="purchasing/suppliers" element={<SuppliersPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["purchasing.view"]} />}>
            <Route path="purchasing/orders" element={<PurchaseOrdersPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["purchasing.receive"]} />}>
            <Route path="purchasing/receiving" element={<ReceivingPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["invoices.manage"]} />}>
            <Route path="purchasing/invoices" element={<InvoicesPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["purchasing.create"]} />}>
            <Route path="purchasing/suggested" element={<SuggestedPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={["reports.sales.view"]} />}>
            <Route path="reports/sales" element={<SalesReportPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["reports.cash.view", "zreport.view"]} />}>
            <Route path="reports/z" element={<ZReportsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["reports.foodcost.view"]} />}>
            <Route path="reports/food-cost" element={<FoodCostPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["reports.inventory.view"]} />}>
            <Route path="reports/inventory" element={<InventoryReportPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["reports.purchasing.view"]} />}>
            <Route path="reports/purchasing" element={<PurchasingReportPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["reports.menu.view"]} />}>
            <Route path="reports/menu" element={<MenuEngineeringPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["reports.fraud.view"]} />}>
            <Route path="reports/fraud" element={<FraudPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={["customers.view"]} />}>
            <Route path="customers" element={<CustomersPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["promotions.manage"]} />}>
            <Route path="marketing/promotions" element={<PromotionsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["coupons.manage"]} />}>
            <Route path="marketing/coupons" element={<CouponsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["loyalty.manage"]} />}>
            <Route path="marketing/loyalty" element={<LoyaltyPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["feedback.view"]} />}>
            <Route path="marketing/feedback" element={<FeedbackPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={["delivery.view"]} />}>
            <Route path="delivery" element={<DeliveriesPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["riders.manage"]} />}>
            <Route path="delivery/riders" element={<RidersPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["delivery.manage"]} />}>
            <Route path="delivery/zones" element={<ZonesPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["staff.view", "staff.manage"]} />}>
            <Route path="staff/employees" element={<EmployeesPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["roster.manage", "staff.view"]} />}>
            <Route path="staff/roster" element={<RosterPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["timeclock.manage", "staff.view"]} />}>
            <Route path="staff/timeclock" element={<TimeClockPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["settings.manage"]} />}>
            <Route path="settings/receipts" element={<ReceiptTemplatePage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["notifications.manage"]} />}>
            <Route path="settings/notifications" element={<NotificationSettingsPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={["menu.view"]} />}>
            <Route path="menu/products" element={<ProductsPage />} />
            <Route path="menu/categories" element={<CategoriesPage />} />
            <Route path="menu/modifiers" element={<ModifierGroupsPage />} />
            <Route path="menu/combos" element={<CombosPage />} />
            <Route path="menu/menus" element={<MenusPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["menu.availability.toggle"]} />}>
            <Route path="menu/availability" element={<AvailabilityPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={["org.view"]} />}>
            <Route path="org/brands" element={<BrandsPage />} />
            <Route path="org/locations" element={<LocationsPage />} />
            <Route path="org/taxes" element={<TaxesPage />} />
            <Route path="org/payment-methods" element={<PaymentMethodsPage />} />
            <Route path="org/tables" element={<TablesPage />} />
            <Route path="org/price-books" element={<PriceBooksPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={["org.view"]} />}>
            <Route path="settings/organization" element={<OrganizationSettingsPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={["users.view"]} />}>
            <Route path="settings/users" element={<UsersPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["roles.view"]} />}>
            <Route path="settings/roles" element={<RolesPage />} />
            <Route path="settings/roles/:id" element={<RoleMatrixPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["audit.view"]} />}>
            <Route path="settings/audit" element={<AuditLogPage />} />
          </Route>

          {/* modules from later phases, and unknown URLs */}
          <Route path="*" element={<ComingSoonPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
