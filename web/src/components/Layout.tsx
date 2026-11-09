import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { btnSecondary } from "./ui";

const navLink = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2.5 py-1.5 text-sm font-medium transition ${isActive ? "bg-ember/10 text-ember" : "text-ink/80 hover:bg-ink/5"}`;

export function Layout() {
  const { user, logout } = useAuth();
  const { count } = useCart();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/" className="font-display text-xl font-bold text-ember">
            🍽️ Ember &amp; Oak
          </Link>

          <nav className="order-3 flex w-full flex-wrap items-center gap-1 sm:order-none sm:w-auto">
            <NavLink to="/" end className={navLink}>
              Menu
            </NavLink>
            {user && (
              <NavLink to="/orders" className={navLink}>
                My orders
              </NavLink>
            )}
            {user?.role === "ADMIN" && (
              <>
                <NavLink to="/admin/orders" className={navLink}>
                  Admin: Orders
                </NavLink>
                <NavLink to="/admin/menu" className={navLink}>
                  Admin: Menu
                </NavLink>
              </>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <NavLink to="/cart" className={navLink} aria-label={`Cart, ${count} items`}>
              🛒 Cart
              {count > 0 && (
                <span className="ml-1.5 rounded-full bg-ember px-1.5 py-0.5 text-xs font-bold text-white">{count}</span>
              )}
            </NavLink>
            {user ? (
              <>
                <span className="hidden text-sm text-muted sm:inline" data-testid="user-name">
                  Hi, {user.name}
                </span>
                <button className={btnSecondary} onClick={logout}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={navLink}>
                  Log in
                </NavLink>
                <Link to="/register" className={btnSecondary}>
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-line py-6 text-center text-sm text-muted">
        Ember &amp; Oak Kitchen · a portfolio project
      </footer>
    </div>
  );
}
