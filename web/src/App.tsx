import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router";
import { AdminLayout } from "./components/AdminLayout";
import { Container, Layout } from "./components/Layout";
import { RequireAdmin, RequireAuth } from "./components/guards";
import { EmptyState, Spinner } from "./components/ui";
import AdminDealsPage from "./pages/AdminDealsPage";
import AdminMenuPage from "./pages/AdminMenuPage";
import AdminOrdersPage from "./pages/AdminOrdersPage";
import CartPage from "./pages/CartPage";
import CheckoutPage from "./pages/CheckoutPage";
import ComingSoonPage from "./pages/ComingSoonPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import OrderDetailPage from "./pages/OrderDetailPage";
import OrdersPage from "./pages/OrdersPage";
import RegisterPage from "./pages/RegisterPage";

// The dashboard pulls in the charting library, so load it only when an admin opens it.
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboardPage"));

export default function App() {
  return (
    <Routes>
      {/* Customer site */}
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route element={<Container />}>
          <Route path="cart" element={<CartPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route element={<RequireAuth />}>
            <Route path="checkout" element={<CheckoutPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:id" element={<OrderDetailPage />} />
          </Route>
          <Route
            path="*"
            element={
              <EmptyState title="Page not found">
                <Link to="/" className="text-brand underline">
                  Back to the menu
                </Link>
              </EmptyState>
            }
          />
        </Route>
      </Route>

      {/* Admin panel: its own layout (dark top bar), admins only */}
      <Route element={<RequireAdmin />}>
        <Route path="admin" element={<AdminLayout />}>
          <Route
            index
            element={
              <Suspense fallback={<Spinner />}>
                <AdminDashboardPage />
              </Suspense>
            }
          />
          <Route path="orders" element={<AdminOrdersPage />} />
          <Route path="menu" element={<AdminMenuPage />} />
          <Route path="deals" element={<AdminDealsPage />} />
          <Route path="reports" element={<ComingSoonPage title="Reports" />} />
          <Route path="settings" element={<ComingSoonPage title="Settings" />} />
        </Route>
      </Route>
    </Routes>
  );
}
