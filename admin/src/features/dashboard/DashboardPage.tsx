import type { PermissionKey } from "@restoflux/contracts";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Building2, CheckCircle2, ChevronRight, Circle, ClipboardCheck, ShoppingBag, Users, Warehouse } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/components/page/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Paged } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";

// Phase 1 dashboard: a setup checklist and live counts. The sales, food-cost and channel charts arrive
// with the orders and reports phases; until then those cards say so instead of showing made-up numbers.

function useCount(path: string, enabled: boolean, params: Record<string, string> = {}) {
  return useQuery({
    queryKey: [path, "count", params],
    queryFn: async () => (await api.get<Paged<unknown>>(path, { pageSize: 1, ...params })).meta.total,
    enabled,
  });
}

function Stat({ label, value, icon, to, loading }: { label: string; value: ReactNode; icon: ReactNode; to?: string; loading?: boolean }) {
  const body = (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</div>
        <div>
          <div className="text-2xl font-bold leading-none">{loading ? <Skeleton className="h-7 w-10" /> : value}</div>
          <div className="mt-1 text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
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

const LATER = [
  { title: "Net sales", phase: "Orders & POS" },
  { title: "Orders by status", phase: "Orders & POS" },
  { title: "Food cost %", phase: "Inventory" },
  { title: "Channel mix", phase: "Orders & POS" },
];

export default function DashboardPage() {
  const me = useMe();
  const { can } = useAuth();
  const org = can("org.view");
  const brands = useCount("/brands", org);
  const branches = useCount("/locations", org, { type: "BRANCH" });
  const taxes = useCount("/tax-profiles", org);
  const methods = useCount("/payment-methods", org);
  const users = useCount("/users", can("users.view"));
  const approvals = useCount("/approvals", can("approvals.view"), { status: "PENDING" });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const setupDone = [brands.data, branches.data, taxes.data, methods.data].every((n) => (n ?? 0) > 0);

  return (
    <>
      <PageHeader title={`${greeting}, ${me.user.name.split(" ")[0]}`} description={`${me.tenant.name} · ${me.allLocations ? "all branches" : `${me.locations.length} branch${me.locations.length === 1 ? "" : "es"}`}`} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Brands" value={brands.data ?? "-"} icon={<Building2 />} to="/org/brands" loading={org && brands.isPending} />
        <Stat label="Branches" value={branches.data ?? "-"} icon={<Warehouse />} to="/org/locations" loading={org && branches.isPending} />
        <Stat label="Team members" value={users.data ?? "-"} icon={<Users />} to="/settings/users" loading={can("users.view") && users.isPending} />
        <Stat label="Waiting for approval" value={approvals.data ?? "-"} icon={<ClipboardCheck />} to="/approvals" loading={can("approvals.view") && approvals.isPending} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {org && (
          <Card className="lg:col-span-3">
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

        <Card className={org ? "lg:col-span-2" : "lg:col-span-5"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart3 className="size-5 text-muted-foreground" /> Performance</CardTitle>
            <CardDescription>These fill in as the modules are switched on.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {LATER.map((l) => (
              <div key={l.title} className="rounded-lg border border-dashed p-3">
                <div className="flex items-center gap-2 text-sm font-medium"><ShoppingBag className="size-4 text-muted-foreground" />{l.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">Available with {l.phase}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
