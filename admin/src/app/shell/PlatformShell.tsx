import { Building2, LogOut, Moon, ScrollText, Sun, Users } from "lucide-react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router";
import { FullPageSpinner } from "@/components/page/states";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { usePlatformAuth } from "@/lib/platform";
import { Logo } from "./Logo";

const NAV = [
  { to: "/platform/organizations", label: "Organizations", icon: Building2 },
  { to: "/platform/audit", label: "Platform audit", icon: ScrollText },
  { to: "/platform/team", label: "Restoflux team", icon: Users },
];

/** Frame for the Restoflux team console: deliberately plain and different from the restaurant app, so nobody mixes them up. */
export function PlatformShell() {
  const { status, me, logout } = usePlatformAuth();
  const { theme, setTheme } = useTheme();
  const location = useLocation();

  if (status === "loading") return <FullPageSpinner label="Restoring your session…" />;
  if (status === "anonymous") return <Navigate to="/platform/login" replace state={{ from: location.pathname }} />;

  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-sidebar px-4 text-sidebar-foreground">
        <Logo size={28} />
        <Badge variant="secondary" className="uppercase tracking-wide">Platform</Badge>
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Platform">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"}`}>
              <n.icon className="size-4" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(dark ? "light" : "dark")}>
            {dark ? <Sun /> : <Moon />}
          </Button>
          <Avatar className="size-7"><AvatarFallback className="bg-primary text-xs text-primary-foreground">{me?.name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
          <span className="hidden text-sm font-medium lg:inline">{me?.name}</span>
          <Button variant="outline" size="sm" onClick={() => void logout()}><LogOut /> Sign out</Button>
        </div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b p-2 md:hidden" aria-label="Platform (mobile)">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-accent font-medium" : "text-muted-foreground"}`}>{n.label}</NavLink>
        ))}
      </nav>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
