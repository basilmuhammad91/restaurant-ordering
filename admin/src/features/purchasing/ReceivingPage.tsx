import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { PackagePlus, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmtDate, fmtDateTime } from "@/components/cells";
import { DataTable } from "@/components/data-table/DataTable";
import { useTableState } from "@/components/data-table/useTableState";
import { PageHeader } from "@/components/page/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { LocationSelect, useInvOptions, useLocationChoice, useMoney } from "@/features/inventory/shared";
import { SimpleSelect } from "@/features/menu/shared";
import { api, errorMessage, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useInvalidate, useList } from "@/lib/queries";
import { ReceiveDialog, type PoDetail } from "./PurchaseOrdersPage";
import { PoBadge, useSuppliers } from "./shared";

interface WaitingRow { id: string; number: string; status: string; supplierName: string; locationName: string; expectedDate: string | null }
interface ReceiptRow { id: string; number: string; supplierName: string; locationName: string; orderNumber: string | null; lineCount: number; totalMinor: number; receivedAt: string }

/** Deliveries: orders waiting to arrive, goods that came without an order, and everything received so far. */
export default function ReceivingPage() {
  const { can } = useAuth();
  const invalidate = useInvalidate();
  const waiting = useQuery({
    queryKey: ["/purchase-orders", "waiting"],
    queryFn: async () => {
      const all = await Promise.all(["APPROVED", "SENT", "PARTIALLY_RECEIVED"].map((status) => api.get<Paged<WaitingRow>>("/purchase-orders", { status, pageSize: 100 })));
      return all.flatMap((r) => r.data);
    },
  });
  const { state, update } = useTableState("-receivedAt", []);
  const list = useList<ReceiptRow>("/goods-receipts", state);
  const [receiving, setReceiving] = useState<string | null>(null);
  const [direct, setDirect] = useState(false);
  const detail = useQuery({ queryKey: ["/purchase-orders", "one", receiving], enabled: !!receiving, queryFn: async () => (await api.get<{ data: PoDetail }>(`/purchase-orders/${receiving}`)).data });

  const columns: ColumnDef<ReceiptRow, any>[] = [
    { accessorKey: "number", header: "Receipt", meta: { label: "Receipt" }, cell: ({ getValue }) => <span className="font-semibold">{getValue()}</span> },
    { accessorKey: "receivedAt", header: "When", meta: { label: "When" }, cell: ({ getValue }) => <span className="text-muted-foreground">{fmtDateTime(getValue())}</span> },
    { accessorKey: "supplierName", header: "Supplier", meta: { label: "Supplier" } },
    { accessorKey: "locationName", header: "Location", meta: { label: "Location" } },
    { accessorKey: "orderNumber", header: "Order", meta: { label: "Order" }, cell: ({ getValue }) => getValue() ?? <span className="text-muted-foreground">No order</span> },
    { accessorKey: "lineCount", header: "Items", meta: { label: "Items" } },
  ];

  return (
    <>
      <PageHeader title="Receiving" description="Check deliveries in against what you ordered. Stock goes up the moment you confirm."
        actions={can("purchasing.receive") ? <Button onClick={() => setDirect(true)}><PackagePlus /> Receive without an order</Button> : undefined} />
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Waiting for delivery</h2>
      <div className="mb-6 divide-y rounded-xl border bg-card">
        {waiting.isPending ? <div className="p-4"><Skeleton className="h-6 w-full" /></div>
          : (waiting.data ?? []).length === 0 ? <p className="p-4 text-sm text-muted-foreground">Nothing is waiting. Approved and sent purchase orders appear here.</p>
          : waiting.data!.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div><div className="font-medium">{o.number} · {o.supplierName}</div><div className="text-sm text-muted-foreground">For {o.locationName}{o.expectedDate ? `, expected ${fmtDate(o.expectedDate)}` : ""}</div></div>
              <div className="flex items-center gap-3"><PoBadge status={o.status} />{can("purchasing.receive") && <Button size="sm" onClick={() => setReceiving(o.id)}>Receive</Button>}</div>
            </div>
          ))}
      </div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Received</h2>
      <DataTable columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update} loading={list.isFetching}
        error={list.isError ? errorMessage(list.error) : null} onRetry={() => void list.refetch()} getRowId={(r) => r.id} searchPlaceholder="Receipt number…"
        emptyTitle="Nothing received yet" emptyDescription="Receipts appear here with the order they belong to." />
      {receiving && detail.data && <ReceiveDialog order={detail.data} onClose={() => setReceiving(null)} onDone={async () => { setReceiving(null); toast.success("Goods received into stock"); await invalidate("/purchase-orders", "/goods-receipts", "/inventory"); }} />}
      {direct && <DirectReceipt onClose={() => setDirect(false)} />}
    </>
  );
}

function DirectReceipt({ onClose }: { onClose: () => void }) {
  const { locationId, setLocationId, locations, location } = useLocationChoice();
  const { items } = useInvOptions();
  const suppliers = useSuppliers();
  const invalidate = useInvalidate();
  const { toMinor, code } = useMoney(location?.currencyCode);
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState([{ itemId: "", packs: "", packQty: "1", price: "" }]);
  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const valid = !!supplierId && lines.every((l) => l.itemId && Number(l.packs) > 0 && Number(l.packQty) > 0 && l.price !== "");
  const save = useMutation({
    mutationFn: () => api.post("/goods-receipts/direct", { locationId, supplierId, lines: lines.map((l) => ({ itemId: l.itemId, packs: Number(l.packs), packQty: Number(l.packQty), unitPriceMinor: toMinor(Number(l.price)) })) }),
    onSuccess: async () => { toast.success("Goods received into stock"); await invalidate("/goods-receipts", "/inventory"); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Receive without an order</DialogTitle><DialogDescription>For a market run or a top-up. Prices are per pack, in {code}.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Into</Label><LocationSelect className="w-full" value={locationId} onChange={setLocationId} locations={locations} /></div>
          <div className="space-y-1.5"><Label>From</Label><SimpleSelect value={supplierId} onChange={setSupplierId} label="Supplier" options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))} placeholder="Choose a supplier" /></div>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[1.5fr_5rem_5rem_6rem_2rem] gap-2 text-xs font-medium text-muted-foreground"><span>Item</span><span>Packs</span><span>Pack holds</span><span>Price / pack</span><span /></div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1.5fr_5rem_5rem_6rem_2rem] items-center gap-2">
              <SimpleSelect value={l.itemId} onChange={(v) => setLine(i, { itemId: v })} label={`Item ${i + 1}`} options={items.map((x) => ({ value: x.id, label: `${x.name} (${x.unit})` }))} placeholder="Item" />
              <Input inputMode="decimal" aria-label="Packs" value={l.packs} onChange={(e) => setLine(i, { packs: e.target.value })} />
              <Input inputMode="decimal" aria-label="Pack size" value={l.packQty} onChange={(e) => setLine(i, { packQty: e.target.value })} />
              <Input inputMode="decimal" aria-label="Price per pack" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} />
              <Button type="button" size="icon" variant="ghost" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { itemId: "", packs: "", packQty: "1", price: "" }])}><Plus /> Add item</Button>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>Receive into stock</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
