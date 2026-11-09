import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink } from "react-router";
import { visibleNav, type NavGroup } from "@/app/nav.config";
import { useAuth } from "@/lib/auth";
import { toPermissionSet } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";

const KEY = "restoflux_nav_groups_v1";

function loadOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

/**
 * The sidebar: only the items the user may use (filtered by permission), grouped as in the spec.
 * Groups made only of not-yet-built modules start collapsed so the built parts stand out.
 */
export function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { me } = useAuth();
  const groups = useMemo(() => visibleNav(toPermissionSet(me)), [me]);
  const [open, setOpen] = useState<Record<string, boolean>>(loadOpen);

  const isOpen = (g: NavGroup) => open[g.label] ?? !g.items.every((i) => i.soon);
  const toggle = (g: NavGroup) =>
    setOpen((o) => {
      const next = { ...o, [g.label]: !isOpen(g) };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  return (
    <aside data-restoflux-sidebar className={cn("flex h-full flex-col border-r bg-sidebar text-sidebar-foreground", collapsed ? "w-16" : "w-64")}>
      <div className={cn("flex h-14 shrink-0 items-center border-b px-4", collapsed && "justify-center px-0")}>
        <Logo size={30} wordmark={!collapsed} />
      </div>

      <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto p-2">
        {groups.map((g) => (
          <div key={g.label} className="pb-1">
            {!collapsed && (
              <button type="button" onClick={() => toggle(g)} aria-expanded={isOpen(g)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                {g.label}
                <ChevronDown className={cn("size-3.5 transition-transform", !isOpen(g) && "-rotate-90")} />
              </button>
            )}
            {(collapsed || isOpen(g)) && (
              <ul className="space-y-0.5">
                {g.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end ?? false}
                      title={item.label}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                          collapsed && "justify-center px-0 py-2",
                          isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                          item.soon && "opacity-60",
                        )
                      }
                    >
                      <item.icon className="size-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {!collapsed && item.soon && <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Soon</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {groups.length === 0 && <p className="px-2 py-4 text-sm text-muted-foreground">No sections are available for your role.</p>}
      </nav>
    </aside>
  );
}
