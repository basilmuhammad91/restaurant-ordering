import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/page/PageHeader";
import { ErrorState } from "@/components/page/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtQty, LocationSelect, useLocationChoice, useMoney } from "@/features/inventory/shared";
import { api, errorMessage } from "@/lib/api";
import { OrderForm, type DraftLine } from "./PurchaseOrdersPage";

interface Line { itemId: string; name: string; unit: string; onHand: number; reorderLevel: number; needQty: number; packName: string; packQty: number; packs: number; unitPriceMinor: number; lineTotalMinor: number }
interface Group { supplierId: string; supplierName: string; lines: Line[]; totalMinor: number }
interface Suggestion { suppliers: Group[]; unsourced: { itemId: string; name: string; unit: string; onHand: number; needQty: number }[] }

/** What to buy now: items at or under their reorder level, topped up to par, grouped by the supplier you normally use. */
export default function SuggestedPage() {
  const { locationId, setLocationId, locations, location } = useLocationChoice();
  const { money, toMajor } = useMoney(location?.currencyCode);
  const q = useQuery({ queryKey: ["/suggested-orders", locationId], enabled: !!locationId, queryFn: async () => (await api.get<{ data: Suggestion }>("/suggested-orders", { locationId })).data });
  const [draft, setDraft] = useState<{ supplierId: string; lines: DraftLine[] } | null>(null);

  const start = (g: Group) => setDraft({ supplierId: g.supplierId, lines: g.lines.map((l) => ({ itemId: l.itemId, packName: l.packName, packQty: l.packQty, packs: String(l.packs), price: String(toMajor(l.unitPriceMinor)) })) });
  const data = q.data;

  return (
    <>
      <PageHeader title="Suggested orders" description="Built from your reorder and par levels, and the preferred supplier set on each item. Nothing is ordered until you create the draft."
        actions={<LocationSelect value={locationId} onChange={setLocationId} locations={locations} />} />
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : q.isPending ? <Skeleton className="h-40 w-full" /> : (
        <div className="space-y-4">
          {data!.suppliers.length === 0 && data!.unsourced.length === 0 && <Card><CardContent className="p-6 text-sm text-muted-foreground">Nothing is running low here. Set a reorder level on an item (Inventory &gt; Items) and it appears when stock falls to it.</CardContent></Card>}
          {data!.suppliers.map((g) => (
            <Card key={g.supplierId}>
              <CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">{g.supplierName}</CardTitle><CardDescription>{g.lines.length} item{g.lines.length === 1 ? "" : "s"} · {money(g.totalMinor)}</CardDescription></div><Button onClick={() => start(g)}>Create purchase order</Button></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Needed</TableHead><TableHead className="text-right">Order</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
                  <TableBody>{g.lines.map((l) => (
                    <TableRow key={l.itemId}>
                      <TableCell className="font-medium">{l.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(l.onHand)} {l.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(l.needQty)} {l.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(l.packs)} × {l.packName}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(l.lineTotalMinor)}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
          {data!.unsourced.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">No supplier set</CardTitle><CardDescription>These are low but nobody is listed as selling them. Add them under Suppliers.</CardDescription></CardHeader>
              <CardContent className="text-sm">{data!.unsourced.map((u) => <div key={u.itemId} className="flex justify-between py-1"><span className="font-medium">{u.name}</span><span className="tabular-nums text-muted-foreground">{fmtQty(u.onHand)} on hand, need {fmtQty(u.needQty)} {u.unit}</span></div>)}</CardContent>
            </Card>
          )}
        </div>
      )}
      {draft && <OrderForm initial={{ locationId, supplierId: draft.supplierId, lines: draft.lines }} onClose={() => setDraft(null)} onSaved={() => setDraft(null)} />}
    </>
  );
}
