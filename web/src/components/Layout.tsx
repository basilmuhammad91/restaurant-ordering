import { Link, NavLink, Outlet } from "react-router";
import { BRAND } from "../brand";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";

const navLink = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2.5 py-1.5 text-sm font-medium transition ${isActive ? "bg-white/10 text-white" : "text-white/75 hover:bg-white/10 hover:text-white"}`;

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold tracking-tight ${className}`}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-ember text-[11px] font-extrabold text-white">{BRAND.initials}</span>
      {BRAND.name}
    </span>
  );
}

// Customer-facing shell: dark header, light page, dark footer.
export function Layout() {
  const { user, logout } = useAuth();
  const { count } = useCart();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 bg-night text-white shadow-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/" className="text-lg text-white">
            <LogoMark />
          </Link>

          <nav className="order-3 flex w-full flex-wrap items-center gap-1 md:order-none md:w-auto">
            <Link to="/#deals" className="rounded-md px-2.5 py-1.5 text-sm font-medium text-white/75 transition hover:bg-white/10 hover:text-white">
              Deals
            </Link>
            <Link to="/#menu" className="rounded-md px-2.5 py-1.5 text-sm font-medium text-white/75 transition hover:bg-white/10 hover:text-white">
              Menu
            </Link>
            {user && (
              <NavLink to="/orders" className={navLink}>
                My orders
              </NavLink>
            )}
            {user?.role === "ADMIN" && (
              <NavLink to="/admin" className={navLink}>
                Admin panel
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <NavLink to="/cart" className={navLink} aria-label={`Cart, ${count} items`}>
              🛒 Cart
              {count > 0 && <span className="ml-1.5 rounded-full bg-ember px-1.5 py-0.5 text-xs font-bold text-white">{count}</span>}
            </NavLink>
            {user ? (
              <>
                <span className="hidden text-sm text-white/70 sm:inline" data-testid="user-name">
                  Hi, {user.name}
                </span>
                <button onClick={logout} className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/10">
                  Log out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={navLink}>
                  Log in
                </NavLink>
                <Link to="/register" className="rounded-lg bg-ember px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-ember-dark">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-night py-8 text-center text-sm text-white/60">
        <LogoMark className="text-white" />
        <p className="mt-2">{BRAND.tagline}</p>
        <p className="mt-1 text-xs text-white/40">A portfolio project</p>
      </footer>
    </div>
  );
}

// Every page except the home page (which has full-width sections) sits in a centred container.
export function Container() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <Outlet />
    </div>
  );
}
