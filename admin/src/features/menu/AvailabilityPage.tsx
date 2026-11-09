import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock, ImageOff, PackageCheck, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Can } from "@/components/Can";
import { fmtDateTime } from "@/components/cells";
import { PageHeader } from "@/components/page/PageHeader";
import { EmptyState, ErrorState, LoadingRows } from "@/components/page/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useScope } from "@/lib/scope";
import { SimpleSelect } from "./shared";

interface Row {
  kind: "product" | "combo";
  id: string;
  name: string;
  imageUrl: string | null;
  category: string;
  isListed: boolean;
  isAvailable: boolean;
  soldOutUntil: string | null;
  sellable: boolean;
}

/** Sold-out durations offered from the row menu. `null` = until someone restocks it. */
const SOLD_OUT_FOR = [
  { label: "Sold out for 1 hour", hours: 1 },
  { label: "Sold out for 3 hours", hours: 3 },
  { label: "Sold out until restocked", hours: null },
] as const;

/**
 * The "86" board: what a branch has run out of right now. Built for a busy kitchen: big switches,
 * one tap to sell out, instant effect on the POS and website. (86 is restaurant slang for "we are out of it".)
 */
export default function AvailabilityPage() {
  const { me } = useAuth();
  const { brandId } = useScope();
  const branches = (me?.locations ?? []).filter((l) => l.type === "BRANCH" && (!brandId || l.brandId === brandId));
  const [locationId, setLocationId] = useState("");
  const [q, setQ] = useState("");
  const [onlyOut, setOnlyOut] = useState(false);

  useEffect(() => { if (!locationId || !branches.some((b) => b.id === locationId)) setLocationId(branches[0]?.id ?? ""); }, [branches, locationId]);

  const key = ["/availability", locationId, q];
  const list = useQuery({ queryKey: key, enabled: !!locationId, queryFn: async () => (await api.get<{ data: Row[] }>("/availability", { locationId, q })).data, refetchInterval: 30_000 });

  const update = useMutation({
    mutationFn: (v: { row: Row; isAvailable?: boolean; isListed?: boolean; soldOutUntil?: string | null }) =>
      api.put("/availability", { locationId, target: v.row.kind === "product" ? { productId: v.row.id } : { comboId: v.row.id }, ...(v.isAvailable !== undefined && { isAvailable: v.isAvailable }), ...(v.isListed !== undefined && { isListed: v.isListed }), ...(v.soldOutUntil !== undefined && { soldOutUntil: v.soldOutUntil }) }),
    onSuccess: () => list.refetch(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const restockAll = useMutation({
    mutationFn: () => api.post<{ data: { restocked: number } }>("/availability/reset", { locationId }),
    onSuccess: async (r) => { toast.success(r.data.restocked ? `${r.data.restocked} item(s) back on the menu` : "Nothing was sold out"); await list.refetch(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rows = (list.data ?? []).filter((r) => !onlyOut || !r.sellable);
  const out = (list.data ?? []).filter((r) => !r.sellable).length;

  return (
    <>
      <PageHeader title="Branch availability (86)" description="Turn an item off the moment the kitchen runs out. It disappears from the POS and the website straight away." actions={<Can permission="menu.availability.toggle"><Button variant="outline" onClick={() => restockAll.mutate()} disabled={!locationId || restockAll.isPending}><PackageCheck /> Restock everything</Button></Can>} />

      {branches.length === 0 ? (
        <EmptyState title="No branches to manage" description="You are not assigned to a branch, or the selected brand has none." />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="w-64"><SimpleSelect value={locationId} onChange={setLocationId} options={branches.map((b) => ({ value: b.id, label: b.name }))} label="Branch" /></div>
            <div className="relative w-64"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" /></div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={onlyOut} onCheckedChange={setOnlyOut} aria-label="Only sold out" /> Only sold out{out > 0 && <Badge variant="secondary" className="bg-red-500/15 text-red-700 dark:text-red-400">{out}</Badge>}</label>
          </div>

          {list.isError ? <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} /> : list.isPending ? <LoadingRows /> : rows.length === 0 ? (
            <EmptyState title={onlyOut ? "Nothing is sold out" : "No items found"} description={onlyOut ? "Everything is on the menu." : "Add products under Menu > Products."} />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((r) => (
                <li key={`${r.kind}-${r.id}`} className={`flex items-center gap-3 rounded-xl border p-3 ${r.sellable ? "bg-card" : "border-red-500/30 bg-red-500/5"}`}>
                  <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground">{r.imageUrl ? <img src={r.imageUrl} alt="" className="size-full object-cover" /> : <ImageOff className="size-4" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {!r.isListed ? "Not sold at this branch" : !r.isAvailable ? (r.soldOutUntil ? <span className="inline-flex items-center gap-1"><Clock className="size-3" /> Back {fmtDateTime(r.soldOutUntil)}</span> : "Sold out until restocked") : r.category}
                    </div>
                  </div>
                  <Can permission="menu.availability.toggle" fallback={<Badge variant="secondary">{r.sellable ? "Available" : "Out"}</Badge>}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label={`More options for ${r.name}`}>•••</Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {r.isAvailable && SOLD_OUT_FOR.map((o) => <DropdownMenuItem key={o.label} onClick={() => update.mutate({ row: r, isAvailable: false, soldOutUntil: o.hours ? new Date(Date.now() + o.hours * 3_600_000).toISOString() : null })}>{o.label}</DropdownMenuItem>)}
                        <DropdownMenuItem onClick={() => update.mutate({ row: r, isListed: !r.isListed })}>{r.isListed ? "Stop selling at this branch" : "Sell at this branch again"}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Switch checked={r.sellable} disabled={!r.isListed || update.isPending} onCheckedChange={(on) => update.mutate({ row: r, isAvailable: on })} aria-label={`${r.name} available`} />
                  </Can>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
