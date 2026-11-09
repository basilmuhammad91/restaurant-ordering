import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import { Outlet } from "react-router";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CommandSearch } from "./CommandSearch";
import { DateRangePicker } from "./DateRangePicker";
import { NotificationsBell } from "./NotificationsBell";
import { ScopeSwitcher } from "./ScopeSwitcher";
import { Sidebar } from "./Sidebar";
import { UserMenu } from "./UserMenu";

const KEY = "restoflux_sidebar_collapsed";

/**
 * The application frame: collapsible left sidebar (a slide-over on tablets/phones), top bar with the
 * brand/branch switcher, global date range, search, notifications and user menu, and the page below.
 */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} />
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0 [&>button]:hidden">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
          <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-4">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <Button variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
          <ScopeSwitcher />
          <DateRangePicker />
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <CommandSearch />
            <NotificationsBell />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
