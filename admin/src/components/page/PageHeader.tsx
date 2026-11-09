import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { allNavItems } from "@/app/nav.config";

// Standard page top: breadcrumbs, title, optional description, and the primary action on the right.

function useCrumbs(): { label: string; to?: string }[] {
  const { pathname } = useLocation();
  // longest matching nav item wins (so /settings/roles/abc maps to "Roles & permissions")
  const item = allNavItems()
    .filter((i) => (i.end ? pathname === i.to : pathname === i.to || pathname.startsWith(`${i.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (!item) return [];
  return [{ label: item.group }, { label: item.label, to: item.to }];
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  const crumbs = useCrumbs();
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Link to="/" className="hover:text-foreground">
              Home
            </Link>
            {crumbs.map((c) => (
              <span key={c.label} className="flex items-center gap-1">
                <ChevronRight className="size-3" />
                {c.to ? (
                  <Link to={c.to} className="hover:text-foreground">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
