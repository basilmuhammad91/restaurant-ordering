import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "../context/AuthContext";
import { Logo } from "./Logo";

const tabs = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/orders", label: "Orders" },
  { to: "/admin/menu", label: "Menu" },
  { to: "/admin/deals", label: "Deals" },
  { to: "/admin/reports", label: "Reports" },
  { to: "/admin/settings", label: "Settings" },
];

// Admin shell: dark top navigation bar with a red active tab, light content area.
export function AdminLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-cream">
      <header className="sticky top-0 z-20 bg-night text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4">
          <Link to="/admin" className="shrink-0 py-3 text-white">
            <Logo onDark />
          </Link>
          <nav className="-mb-px flex flex-1 items-stretch gap-1 overflow-x-auto" aria-label="Admin">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end ?? false}
                className={({ isActive }) =>
                  `flex shrink-0 items-center border-b-4 px-3 py-4 text-sm font-semibold transition ${
                    isActive ? "border-brand text-white" : "border-transparent text-white/65 hover:text-white"
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            <Link to="/" className="hidden text-white/70 hover:text-white sm:inline">
              View site ↗
            </Link>
            <span className="hidden text-white/70 md:inline">{user?.name}</span>
            <button onClick={logout} className="rounded-lg border border-white/25 px-3 py-1.5 font-semibold transition hover:bg-white/10">
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
