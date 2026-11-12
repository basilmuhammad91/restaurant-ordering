import type { PermissionKey } from "@restoflux/contracts";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "@/components/page/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SalesPanel } from "./SalesPanel";
import { api, type Paged } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";

// The dashboard: sales for the brand, branches and dates chosen in the top bar, then a setup checklist and counts.
// Food cost and the deeper reports arrive with the inventory and reports phases.

function useCount(path: string, enabled: boolean, params: Record<string, string> = {}) {
  return useQuery({
    queryKey: [path, "count", params],
    queryFn: async () => (await api.get<Paged<unknown>>(path, { pageSize: 1, ...params })).meta.total,
    enabled,
  });
}

function Step({ done, title, hint, to, can }: { done: boolean; title: string; hint: string; to: string; can: boolean }) {
  const inner = (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-accent">
      {done ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" /> : <Circle className="size-5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <div className={done ? "font-medium line-through decoration-muted-foreground/50" : "font-medium"}>{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <ChevronRight className="size-4 text-muted-foreground" />
    </div>
  );
  return can ? <Link to={to}>{inner}</Link> : <div className="opacity-60">{inner}</div>;
}

export default function DashboardPage() {
  const me = useMe();
  const { can } = useAuth();
  const org = can("org.view");
  const brands = useCount("/brands", org);
  const branches = useCount("/locations", org, { type: "BRANCH" });
  const taxes = useCount("/tax-profiles", org);
  const methods = useCount("/payment-methods", org);
  const users = useCount("/users", can("users.view"));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const setupDone = [brands.data, branches.data, taxes.data, methods.data].every((n) => (n ?? 0) > 0);

  return (
    <>
      <PageHeader title={`${greeting}, ${me.user.name.split(" ")[0]}`} description={`${me.tenant.name} · ${me.allLocations ? "all branches" : `${me.locations.length} branch${me.locations.length === 1 ? "" : "es"}`}${brands.data ? ` · ${brands.data} brand${brands.data === 1 ? "" : "s"}` : ""}${users.data ? ` · ${users.data} team members` : ""}`} />

      {can("dashboard.view") && <SalesPanel />}

      <div className="grid gap-3">
        {org && !setupDone && !brands.isPending && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Set up your company {setupDone && <Badge className="bg-emerald-600">Done</Badge>}</CardTitle>
              <CardDescription>The foundations every branch needs before it can take orders.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Step done={(brands.data ?? 0) > 0} title="Create a brand" hint="Your restaurant concept (you can have several)." to="/org/brands" can={can("org.manage")} />
              <Step done={(taxes.data ?? 0) > 0} title="Add a tax profile" hint="Which taxes apply, and whether prices include them." to="/org/taxes" can={can("taxes.manage" as PermissionKey)} />
              <Step done={(branches.data ?? 0) > 0} title="Add a branch" hint="Currency, timezone, opening hours, tax profile." to="/org/locations" can={can("locations.manage")} />
              <Step done={(methods.data ?? 0) > 0} title="Check payment methods" hint="Cash, cards and wallets are pre-loaded. Enable them per branch." to="/org/payment-methods" can={can("org.view")} />
              <Step done={(users.data ?? 0) > 1} title="Invite your team" hint="Managers, cashiers, kitchen staff, each with the right role." to="/settings/users" can={can("users.manage")} />
            </CardContent>
          </Card>
        )}

      </div>
    </>
  );
}
