import { Link, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { RequireAdmin, RequireAuth } from "./components/guards";
import { EmptyState } from "./components/ui";
import AdminMenuPage from "./pages/AdminMenuPage";
import AdminOrdersPage from "./pages/AdminOrdersPage";
import CartPage from "./pages/CartPage";
import CheckoutPage from "./pages/CheckoutPage";
import LoginPage from "./pages/LoginPage";
import MenuPage from "./pages/MenuPage";
import OrderDetailPage from "./pages/OrderDetailPage";
import OrdersPage from "./pages/OrdersPage";
import RegisterPage from "./pages/RegisterPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<MenuPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />

        <Route element={<RequireAuth />}>
          <Route path="checkout" element={<CheckoutPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/:id" element={<OrderDetailPage />} />
        </Route>

        <Route element={<RequireAdmin />}>
          <Route path="admin/orders" element={<AdminOrdersPage />} />
          <Route path="admin/menu" element={<AdminMenuPage />} />
        </Route>

        <Route
          path="*"
          element={
            <EmptyState title="Page not found">
              <Link to="/" className="text-ember underline">
                Back to the menu
              </Link>
            </EmptyState>
          }
        />
      </Route>
    </Routes>
  );
}
