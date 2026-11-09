import { Navigate, Outlet, Route, Routes } from "react-router";
import { RequireAuth, RequirePermission } from "@/app/guards";
import { AppShell } from "@/app/shell/AppShell";
import { PlatformShell } from "@/app/shell/PlatformShell";
import ApprovalsPage from "@/features/approvals/ApprovalsPage";
import LoginPage from "@/features/auth/LoginPage";
import { ComingSoonPage, WelcomePage } from "@/features/common/CommonPages";
import DashboardPage from "@/features/dashboard/DashboardPage";
import BrandsPage from "@/features/org/BrandsPage";
import LocationsPage from "@/features/org/LocationsPage";
import PaymentMethodsPage from "@/features/org/PaymentMethodsPage";
import PriceBooksPage from "@/features/org/PriceBooksPage";
import TablesPage from "@/features/org/TablesPage";
import TaxesPage from "@/features/org/TaxesPage";
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
        <Route element={<AppShell />}>
          <Route index element={can("dashboard.view") ? <DashboardPage /> : <WelcomePage />} />

          <Route element={<RequirePermission anyOf={["approvals.view"]} />}>
            <Route path="approvals" element={<ApprovalsPage />} />
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
