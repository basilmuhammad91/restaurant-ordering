import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, Plus, Trash2, Truck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmtDateTime } from "@/components/cells";
import { DataTable } from "@/components/data-table/DataTable";
import { useTableState } from "@/components/data-table/useTableState";
import { PageHeader } from "@/components/page/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SimpleSelect } from "@/features/menu/shared";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useInvalidate, useList } from "@/lib/queries";
import { DocBadge, fmtQty, LocationSelect, useInvOptions, useStockLocations } from "./shared";

interface TransferRow { id: string; number: string; status: string; fromLocationId: string; toLocationId: string; fromName: string; toName: string; lineCount: number; createdAt: string }
interface TransferLine { id: string; itemId: string; qty: number; receivedQty: number | null; item: { name: string; unit: string } }
interface TransferDetail extends TransferRow { note: string | null; lines: TransferLine[] }

/** Stock moving between branches, warehouses and the central kitchen: requested, sent, then received at the other end. */
export default function TransfersPage() {
  const { can } = useAuth();
  const { state, update } = useTableState("-createdAt", ["status"]);
  const list = useList<TransferRow>("/stock-transfers", state);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const columns: ColumnDef<TransferRow, any>[] = [
    { accessorKey: "number", header: "Transfer", meta: { label: "Transfer" }, cell: ({ getValue }) => <span className="font-semibold">{getValue()}</span> },
    { id: "route", header: "From / to", meta: { label: "From / to" }, cell: ({ row }) => <span className="inline-flex items-center gap-1.5">{row.original.fromName} <ArrowRight className="size-3.5 text-muted-foreground" /> {row.original.toName}</span> },
    { accessorKey: "lineCount", header: "Items", meta: { label: "Items" } },
    { accessorKey: "createdAt", header: "Requested", meta: { label: "Requested" }, cell: ({ getValue }) => <span className="text-muted-foreground">{fmtDateTime(getValue())}</span> },
    { accessorKey: "status", header: "Status", meta: { label: "Status" }, cell: ({ getValue }) => <DocBadge status={getValue()} /> },
  ];

  return (
    <>
      <PageHeader title="Transfers" description="Send stock from one location to another. It leaves the sender when shipped and arrives when the receiver confirms."
        actions={can("inventory.transfer") ? <Button onClick={() => setCreating(true)}><Truck /> New transfer</Button> : undefined} />
      <DataTable columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update} loading={list.isFetching}
        error={list.isError ? errorMessage(list.error) : null} onRetry={() => void list.refetch()} getRowId={(r) => r.id} onRowClick={(r) => setOpen(r.id)} hideSearch
        filters={<SimpleSelect className="w-40" allowEmpty emptyLabel="Any status" value={state.filters.status ?? ""} onChange={(v) => update({ filters: { status: v || undefined } })} label="Status" options={["REQUESTED", "IN_TRANSIT", "RECEIVED", "CANCELLED"].map((s) => ({ value: s, label: s === "IN_TRANSIT" ? "In transit" : s.charAt(0) + s.slice(1).toLowerCase() }))} />}
        emptyTitle="No transfers yet" emptyDescription="Move stock from the warehouse to a branch, or between branches." />
      {creating && <NewTransfer onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpen(id); }} />}
      {open && <TransferSheet id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function NewTransfer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const locations = useStockLocations();
  const { items } = useInvOptions();
  const invalidate = useInvalidate();
  const [from, setFrom] = useState(locations[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState([{ itemId: "", qty: "" }]);
  const unitOf = (id: string) => items.find((i) => i.id === id)?.unit ?? "";
  const valid = !!from && !!to && from !== to && lines.every((l) => l.itemId && Number(l.qty) > 0);
  const create = useMutation({
    mutationFn: async () => (await api.post<{ data: { id: string } }>("/stock-transfers", { fromLocationId: from, toLocationId: to, note: note.trim() || null, lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) })).data,
    onSuccess: async (t) => { toast.success("Transfer requested"); await invalidate("/stock-transfers"); onCreated(t.id); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>New transfer</DialogTitle><DialogDescription>Nothing moves until the sender ships it.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>From</Label><LocationSelect className="w-full" value={from} onChange={setFrom} locations={locations} label="From" /></div>
          <div className="space-y-1.5"><Label>To</Label><LocationSelect className="w-full" value={to} onChange={setTo} locations={locations.filter((l) => l.id !== from)} label="To" /></div>
        </div>
        <div className="space-y-2">
          <Label>Items</Label>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_2rem] items-center gap-2">
              <SimpleSelect value={l.itemId} onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, itemId: v } : x)))} label={`Item ${i + 1}`} options={items.map((x) => ({ value: x.id, label: x.name }))} placeholder="Item" />
              <div className="relative"><Input inputMode="decimal" aria-label="Quantity" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className="pr-9" /><span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{unitOf(l.itemId)}</span></div>
              <Button type="button" size="icon" variant="ghost" aria-label="Remove item" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { itemId: "", qty: "" }])}><Plus /> Add item</Button>
        </div>
        <div className="space-y-1.5"><Label htmlFor="trf-note">Note (optional)</Label><Input id="trf-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>Request transfer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { me, can } = useAuth();
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: ["/stock-transfers", "one", id], queryFn: async () => (await api.get<{ data: TransferDetail }>(`/stock-transfers/${id}`)).data });
  const [received, setReceived] = useState<Record<string, string>>({});
  const t = q.data;
  const reach = (locationId: string) => me?.allLocations || (me?.locations ?? []).some((l) => l.id === locationId);
  const after = async () => { await invalidate("/stock-transfers", "/inventory"); onClose(); };
  const ship = useMutation({ mutationFn: () => api.post(`/stock-transfers/${id}/ship`, {}), onSuccess: async () => { toast.success("Shipped: stock has left the sender"); await after(); }, onError: (e) => toast.error(errorMessage(e)) });
  const receive = useMutation({
    mutationFn: () => api.post(`/stock-transfers/${id}/receive`, { lines: (t?.lines ?? []).map((l) => ({ itemId: l.itemId, receivedQty: received[l.itemId] !== undefined && received[l.itemId] !== "" ? Number(received[l.itemId]) : l.qty })) }),
    onSuccess: async () => { toast.success("Received into stock"); await after(); }, onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({ mutationFn: () => api.post(`/stock-transfers/${id}/cancel`, {}), onSuccess: after, onError: (e) => toast.error(errorMessage(e)) });
  const busy = ship.isPending || receive.isPending || cancel.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{t ? `${t.number}: ${t.fromName} to ${t.toName}` : "Transfer"}</DialogTitle><DialogDescription>{t && <DocBadge status={t.status} />}{t?.note ? ` ${t.note}` : ""}</DialogDescription></DialogHeader>
        {!t ? <Skeleton className="h-32 w-full" /> : (
          <>
            <div className="divide-y rounded-lg border">
              {t.lines.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="font-medium">{l.item.name}</span>
                  <span className="flex items-center gap-2 text-sm tabular-nums">
                    {fmtQty(l.qty)} {l.item.unit}
                    {t.status === "IN_TRANSIT" && reach(t.toLocationId) && <><ArrowRight className="size-3.5 text-muted-foreground" /><Input inputMode="decimal" aria-label={`Received ${l.item.name}`} className="h-8 w-24 text-right" placeholder={String(l.qty)} value={received[l.itemId] ?? ""} onChange={(e) => setReceived((s) => ({ ...s, [l.itemId]: e.target.value }))} /></>}
                    {t.status === "RECEIVED" && <span className="text-muted-foreground">arrived {fmtQty(l.receivedQty ?? 0)}</span>}
                  </span>
                </div>
              ))}
            </div>
            <DialogFooter className="sm:justify-between">
              {t.status === "REQUESTED" ? <Button variant="ghost" disabled={busy} onClick={() => cancel.mutate()}>Cancel transfer</Button> : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Close</Button>
                {t.status === "REQUESTED" && can("inventory.transfer.approve") && reach(t.fromLocationId) && <Button disabled={busy} onClick={() => ship.mutate()}>Ship it</Button>}
                {t.status === "IN_TRANSIT" && reach(t.toLocationId) && <Button disabled={busy} onClick={() => receive.mutate()}>Confirm received</Button>}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
