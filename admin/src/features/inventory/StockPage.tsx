import { useQuery } from "@tanstack/react-query";
import { PackageMinus, Search } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page/PageHeader";
import { ErrorState } from "@/components/page/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AdjustDialog } from "./AdjustDialog";
import { fmtQty, KIND_LABEL, LocationSelect, useLocationChoice, useMoney } from "./shared";

interface Row { itemId: string; name: string; sku: string | null; kind: string; unit: string; category: string | null; qty: number; avgCost: number; valueMinor: number; reorderLevel: number | null; parLevel: number | null; status: "ok" | "low" | "out" }
interface Result { data: Row[]; meta: { totalValueMinor: number; lowCount: number; outCount: number } }

const STATUS = { ok: ["In stock", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"], low: ["Low", "bg-amber-500/15 text-amber-700 dark:text-amber-400"], out: ["Out", "bg-red-500/15 text-red-700 dark:text-red-400"] } as const;

/** What is on the shelf at one location, what it is worth, and what is running low. */
export default function StockPage() {
  const { can } = useAuth();
  const { locationId, setLocationId, locations, location } = useLocationChoice();
  const { money } = useMoney(location?.currencyCode);
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [adjust, setAdjust] = useState<Row | "new" | null>(null);

  const list = useQuery({
    queryKey: ["/inventory", "stock", locationId, q, lowOnly], enabled: !!locationId,
    queryFn: () => api.get<Result>("/inventory/stock", { locationId, ...(q ? { q } : {}), ...(lowOnly ? { low: true } : {}) }),
  });
  const rows = list.data?.data ?? [];

  return (
    <>
      <PageHeader title="Stock on hand" description="Quantities and value at one location. Every number comes from the stock ledger."
        actions={<div className="flex flex-wrap items-center gap-2"><LocationSelect value={locationId} onChange={setLocationId} locations={locations} />{can("inventory.adjust") && <Button onClick={() => setAdjust("new")}><PackageMinus /> Adjust stock</Button>}</div>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Stock value</div><div className="text-2xl font-bold tabular-nums">{list.data ? money(list.data.meta.totalValueMinor) : "-"}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Running low</div><div className="text-2xl font-bold tabular-nums">{list.data?.meta.lowCount ?? "-"}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Out of stock</div><div className="text-2xl font-bold tabular-nums">{list.data?.meta.outCount ?? "-"}</div></CardContent></Card>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-72 max-w-full"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" /></div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" className="size-4" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Only low or out</label>
      </div>
      {list.isError ? <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} /> : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Type</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Average cost</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Status</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
            <TableBody>
              {list.isPending ? [0, 1, 2, 3, 4].map((i) => <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)
                : rows.length === 0 ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{q || lowOnly ? "Nothing matches." : "No inventory items yet. Add them under Inventory > Items."}</TableCell></TableRow>
                : rows.map((r) => (
                  <TableRow key={r.itemId}>
                    <TableCell><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{[r.sku, r.category].filter(Boolean).join(" · ")}</div></TableCell>
                    <TableCell><Badge variant="secondary">{KIND_LABEL[r.kind]}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{fmtQty(r.qty)} {r.unit}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.avgCost)}<span className="text-xs text-muted-foreground"> /{r.unit}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.valueMinor)}</TableCell>
                    <TableCell><Badge variant="secondary" className={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge></TableCell>
                    <TableCell className="text-right">{can("inventory.adjust") && <Button size="sm" variant="ghost" onClick={() => setAdjust(r)}>Adjust</Button>}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}
      {adjust && <AdjustDialog locationId={locationId} {...(adjust !== "new" ? { item: { id: adjust.itemId, name: adjust.name, unit: adjust.unit } } : {})} onClose={() => setAdjust(null)} />}
    </>
  );
}
