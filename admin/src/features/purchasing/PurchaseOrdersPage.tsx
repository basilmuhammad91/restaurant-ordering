import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, ShoppingCart, Trash2 } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtQty, LocationSelect, useInvOptions, useMoney, useStockLocations } from "@/features/inventory/shared";
import { SimpleSelect } from "@/features/menu/shared";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useInvalidate, useList } from "@/lib/queries";
import { PO_STATUSES, PoBadge, useSuppliers } from "./shared";

interface PoRow { id: string; number: string; status: string; supplierName: string; locationName: string; locationId: string; supplierId: string; currencyCode: string; totalMinor: number; lineCount: number; expectedDate: string | null; createdAt: string }
interface PoLine { id: string; itemId: string; packName: string; packQty: number; orderedPacks: number; receivedPacks: number; unitPriceMinor: number; lineTotalMinor: number; item: { name: string; unit: string } }
interface PoDetail extends PoRow { note: string | null; lines: PoLine[] }
export interface DraftLine { itemId: string; packName: string; packQty: number; packs: string; price: string }

/** Orders to suppliers: draft, approve, send, then receive as the goods arrive. */
export default function PurchaseOrdersPage() {
  const { can } = useAuth();
  const { state, update } = useTableState("-createdAt", ["status", "supplierId"]);
  const list = useList<PoRow>("/purchase-orders", state);
  const suppliers = useSuppliers();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const columns: ColumnDef<PoRow, any>[] = [
    { accessorKey: "number", header: "Order", meta: { label: "Order" }, cell: ({ getValue }) => <span className="font-semibold">{getValue()}</span> },
    { accessorKey: "supplierName", header: "Supplier", meta: { label: "Supplier" } },
    { accessorKey: "locationName", header: "Deliver to", meta: { label: "Deliver to" } },
    { accessorKey: "lineCount", header: "Items", meta: { label: "Items" } },
    { id: "total", header: "Total", meta: { label: "Total" }, cell: ({ row }) => <Money minor={row.original.totalMinor} currency={row.original.currencyCode} /> },
    { accessorKey: "expectedDate", header: "Expected", meta: { label: "Expected" }, cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() ? fmtDate(getValue()) : "-"}</span> },
    { accessorKey: "status", header: "Status", meta: { label: "Status" }, cell: ({ getValue }) => <PoBadge status={getValue()} /> },
  ];
  return (
    <>
      <PageHeader title="Purchase orders" description="What you have asked suppliers to deliver, and where each order stands."
        actions={can("purchasing.create") ? <Button onClick={() => setCreating(true)}><ShoppingCart /> New order</Button> : undefined} />
      <DataTable columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update} loading={list.isFetching}
        error={list.isError ? errorMessage(list.error) : null} onRetry={() => void list.refetch()} getRowId={(r) => r.id} onRowClick={(r) => setOpen(r.id)} searchPlaceholder="Order number…"
        filters={<>
          <SimpleSelect className="w-40" allowEmpty emptyLabel="Any status" value={state.filters.status ?? ""} onChange={(v) => update({ filters: { status: v || undefined } })} label="Status" options={PO_STATUSES} />
          <SimpleSelect className="w-44" allowEmpty emptyLabel="Any supplier" value={state.filters.supplierId ?? ""} onChange={(v) => update({ filters: { supplierId: v || undefined } })} label="Supplier" options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        </>}
        emptyTitle="No purchase orders" emptyDescription="Raise one here, or use Suggested orders to start from what is running low." />
      {creating && <OrderForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); setOpen(id); }} />}
      {open && <OrderSheet id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Money({ minor, currency }: { minor: number; currency: string }) {
  const { money } = useMoney(currency);
  return <span className="whitespace-nowrap tabular-nums">{money(minor)}</span>;
}

/** Create a draft (or edit one). `initial` pre-fills the form, for orders suggested from low stock. */
export function OrderForm({ orderId, initial, onClose, onSaved }: {
  orderId?: string; initial?: { locationId?: string; supplierId?: string; lines?: DraftLine[] }; onClose: () => void; onSaved: (id: string) => void;
}) {
  const locations = useStockLocations();
  const { items } = useInvOptions();
  const suppliers = useSuppliers();
  const invalidate = useInvalidate();
  const [locationId, setLocationId] = useState(initial?.locationId ?? locations[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [expected, setExpected] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(initial?.lines ?? [{ itemId: "", packName: "Each", packQty: 1, packs: "", price: "" }]);
  const location = locations.find((l) => l.id === locationId);
  const { money, toMinor, toMajor, code } = useMoney(location?.currencyCode);
  const catalogue = useQuery({ queryKey: ["/supplier-items", "for", supplierId], enabled: !!supplierId, queryFn: async () => (await api.get<{ data: { itemId: string; packName: string; packQty: number; priceMinor: number }[] }>("/supplier-items", { supplierId, pageSize: 100 })).data });
  const existing = useQuery({
    queryKey: ["/purchase-orders", "one", orderId], enabled: !!orderId,
    queryFn: async () => (await api.get<{ data: PoDetail }>(`/purchase-orders/${orderId}`)).data,
  });
  const [loaded, setLoaded] = useState(false);
  if (orderId && existing.data && !loaded) {
    setLoaded(true); setLocationId(existing.data.locationId); setSupplierId(existing.data.supplierId); setExpected(existing.data.expectedDate?.slice(0, 10) ?? "");
    setLines(existing.data.lines.map((l) => ({ itemId: l.itemId, packName: l.packName, packQty: l.packQty, packs: String(l.orderedPacks), price: String(toMajor(l.unitPriceMinor)) })));
  }
  const pick = (i: number, itemId: string) => {
    const known = catalogue.data?.find((c) => c.itemId === itemId);
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, itemId, ...(known ? { packName: known.packName, packQty: known.packQty, price: String(toMajor(known.priceMinor)) } : { packName: "Each", packQty: 1 }) } : l)));
  };
  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + Number(l.packs || 0) * toMinor(Number(l.price || 0)), 0);
  const valid = !!locationId && !!supplierId && lines.every((l) => l.itemId && Number(l.packs) > 0 && l.price !== "");

  const save = useMutation({
    mutationFn: async () => {
      const body = { locationId, supplierId, expectedDate: expected || null, lines: lines.map((l) => ({ itemId: l.itemId, packName: l.packName, packQty: l.packQty, orderedPacks: Number(l.packs), unitPriceMinor: toMinor(Number(l.price)) })) };
      return (await (orderId ? api.put<{ data: { id: string } }>(`/purchase-orders/${orderId}`, body) : api.post<{ data: { id: string } }>("/purchase-orders", body))).data;
    },
    onSuccess: async (o) => { toast.success(orderId ? "Order updated" : "Draft created"); await invalidate("/purchase-orders"); onSaved(o.id); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{orderId ? "Edit draft order" : "New purchase order"}</DialogTitle><DialogDescription>Prices are per pack, in {code}. Pick the supplier first and their packs and prices fill in.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label>Deliver to</Label><LocationSelect className="w-full" value={locationId} onChange={setLocationId} locations={locations} /></div>
          <div className="space-y-1.5"><Label>Supplier</Label><SimpleSelect value={supplierId} onChange={setSupplierId} label="Supplier" options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))} placeholder="Choose" /></div>
          <div className="space-y-1.5"><Label htmlFor="po-exp">Expected on</Label><Input id="po-exp" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[1.5fr_1fr_5rem_6rem_2rem] gap-2 text-xs font-medium text-muted-foreground"><span>Item</span><span>Pack</span><span>Packs</span><span>Price / pack</span><span /></div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1.5fr_1fr_5rem_6rem_2rem] items-center gap-2">
              <SimpleSelect value={l.itemId} onChange={(v) => pick(i, v)} label={`Item ${i + 1}`} options={items.map((x) => ({ value: x.id, label: x.name }))} placeholder="Item" />
              <div className="text-sm text-muted-foreground">{l.itemId ? `${l.packName} (${fmtQty(l.packQty)} ${items.find((x) => x.id === l.itemId)?.unit ?? ""})` : "-"}</div>
              <Input inputMode="decimal" aria-label="Packs" value={l.packs} onChange={(e) => setLine(i, { packs: e.target.value })} />
              <Input inputMode="decimal" aria-label="Price per pack" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} />
              <Button type="button" size="icon" variant="ghost" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <div className="flex items-center justify-between"><Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { itemId: "", packName: "Each", packQty: 1, packs: "", price: "" }])}><Plus /> Add item</Button><span className="font-semibold tabular-nums">Total {money(total)}</span></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{orderId ? "Save changes" : "Create draft"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: ["/purchase-orders", "one", id], queryFn: async () => (await api.get<{ data: PoDetail }>(`/purchase-orders/${id}`)).data });
  const [editing, setEditing] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const o = q.data;
  const { money } = useMoney(o?.currencyCode);
  const after = async (msg: string) => { toast.success(msg); await invalidate("/purchase-orders", "/inventory", "/goods-receipts"); await q.refetch(); };
  const act = (path: string, msg: string) => useMutationAction(`/purchase-orders/${id}/${path}`, () => after(msg));
  const approve = act("approve", "Approved");
  const send = act("send", "Marked as sent");
  const cancel = act("cancel", "Order cancelled");
  const busy = approve.isPending || send.isPending || cancel.isPending;

  if (editing) return <OrderForm orderId={id} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void q.refetch(); }} />;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{o ? `${o.number} · ${o.supplierName}` : "Purchase order"}</DialogTitle><DialogDescription>{o && <><PoBadge status={o.status} /> Deliver to {o.locationName}{o.expectedDate ? `, expected ${fmtDate(o.expectedDate)}` : ""}</>}</DialogDescription></DialogHeader>
        {!o ? <Skeleton className="h-40 w-full" /> : (
          <>
            <div className="rounded-lg border">
              <Table>
                <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                <TableBody>
                  {o.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell><div className="font-medium">{l.item.name}</div><div className="text-xs text-muted-foreground">{l.packName} ({fmtQty(l.packQty)} {l.item.unit})</div></TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(l.orderedPacks)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(l.receivedPacks)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(l.unitPriceMinor)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(l.lineTotalMinor)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow><TableCell colSpan={4} className="text-right font-semibold">Total</TableCell><TableCell className="text-right font-semibold tabular-nums">{money(o.totalMinor)}</TableCell></TableRow>
                </TableBody>
              </Table>
            </div>
            {o.note && <p className="text-sm text-muted-foreground">{o.note}</p>}
            <p className="text-xs text-muted-foreground">Created {fmtDateTime(o.createdAt)}</p>
            <DialogFooter className="sm:justify-between">
              {["DRAFT", "APPROVED", "SENT"].includes(o.status) && can("purchasing.create") ? <Button variant="ghost" disabled={busy} onClick={() => cancel.mutate()}>Cancel order</Button> : <span />}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={onClose}>Close</Button>
                {o.status === "DRAFT" && can("purchasing.create") && <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
                {o.status === "DRAFT" && can("purchasing.approve") && <Button disabled={busy} onClick={() => approve.mutate()}>Approve</Button>}
                {o.status === "APPROVED" && can("purchasing.create") && <Button disabled={busy} onClick={() => send.mutate()}>Mark as sent</Button>}
                {["APPROVED", "SENT", "PARTIALLY_RECEIVED"].includes(o.status) && can("purchasing.receive") && <Button onClick={() => setReceiving(true)}>Receive goods</Button>}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
      {receiving && o && <ReceiveDialog order={o} onClose={() => setReceiving(false)} onDone={async () => { setReceiving(false); await after("Goods received into stock"); }} />}
    </Dialog>
  );
}

function useMutationAction(path: string, onSuccess: () => unknown) {
  return useMutation({ mutationFn: () => api.post(path, {}), onSuccess, onError: (e) => toast.error(errorMessage(e)) });
}

/** Enter how many packs of each line actually arrived. Starts at "everything still outstanding". */
export function ReceiveDialog({ order, onClose, onDone }: { order: PoDetail; onClose: () => void; onDone: () => void }) {
  const remaining = (l: PoLine) => Math.max(0, l.orderedPacks - l.receivedPacks);
  const [packs, setPacks] = useState<Record<string, string>>(() => Object.fromEntries(order.lines.map((l) => [l.itemId, String(remaining(l))])));
  const [note, setNote] = useState("");
  const body = order.lines.map((l) => ({ itemId: l.itemId, packs: Number(packs[l.itemId] || 0) })).filter((l) => l.packs > 0);
  const save = useMutation({ mutationFn: () => api.post(`/purchase-orders/${order.id}/receive`, { note: note.trim() || null, lines: body }), onSuccess: onDone, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Receive goods for {order.number}</DialogTitle><DialogDescription>Enter what actually arrived, in packs. Stock goes up now, at the order's price.</DialogDescription></DialogHeader>
        <div className="divide-y rounded-lg border">
          {order.lines.filter((l) => remaining(l) > 0).map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div><div className="font-medium">{l.item.name}</div><div className="text-xs text-muted-foreground">{fmtQty(remaining(l))} {l.packName} outstanding</div></div>
              <Input inputMode="decimal" aria-label={`Received ${l.item.name}`} className="h-9 w-24 text-right" value={packs[l.itemId] ?? ""} onChange={(e) => setPacks((s) => ({ ...s, [l.itemId]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div className="space-y-1.5"><Label htmlFor="rcv-note">Note (optional)</Label><Input id="rcv-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Delivery note number, damaged goods…" /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={body.length === 0 || save.isPending} onClick={() => save.mutate()}>Receive into stock</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { PoDetail, PoLine };
