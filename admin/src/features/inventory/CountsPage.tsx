import { useMutation, useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useInvalidate, useList } from "@/lib/queries";
import type { ColumnDef } from "@tanstack/react-table";
import { DocBadge, fmtQty, LocationSelect, useLocationChoice, useMoney, useStockLocations } from "./shared";

interface CountRow { id: string; number: string; status: string; locationId: string; locationName: string; lineCount: number; countedCount: number; varianceValueMinor: number; createdAt: string }
interface CountLine { id: string; itemId: string; expectedQty: number; countedQty: number | null; unitCost: number; item: { name: string; unit: string; category: string | null } }
interface CountDetail { id: string; number: string; status: string; locationId: string; location: { name: string }; lines: CountLine[] }

/** Stock takes. Count what is physically there, submit, and a manager approves; approval corrects the system to match. */
export default function CountsPage() {
  const { me, can } = useAuth();
  const locations = useStockLocations();
  const { state, update } = useTableState("-createdAt", []);
  const list = useList<CountRow>("/stock-counts", state);
  const [open, setOpen] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const { money } = useMoney(me?.tenant.baseCurrency);

  const columns: ColumnDef<CountRow, any>[] = [
    { accessorKey: "number", header: "Count", meta: { label: "Count" }, cell: ({ getValue }) => <span className="font-semibold">{getValue()}</span> },
    { accessorKey: "locationName", header: "Location", meta: { label: "Location" } },
    { accessorKey: "createdAt", header: "Started", meta: { label: "Started" }, cell: ({ getValue }) => <span className="text-muted-foreground">{fmtDateTime(getValue())}</span> },
    { id: "progress", header: "Counted", meta: { label: "Counted" }, cell: ({ row }) => <span className="tabular-nums">{row.original.countedCount} / {row.original.lineCount}</span> },
    { id: "variance", header: "Difference", meta: { label: "Difference" }, cell: ({ row }) => row.original.countedCount === 0 ? "-" : <span className={`tabular-nums ${row.original.varianceValueMinor < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{money(row.original.varianceValueMinor)}</span> },
    { accessorKey: "status", header: "Status", meta: { label: "Status" }, cell: ({ getValue }) => <DocBadge status={getValue()} /> },
  ];

  return (
    <>
      <PageHeader title="Stock counts" description="Count the shelves, compare with the system, and correct the difference once a manager approves."
        actions={can("inventory.count") && locations.length > 0 ? <Button onClick={() => setStarting(true)}><ClipboardList /> Start a count</Button> : undefined} />
      <DataTable columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update} loading={list.isFetching}
        error={list.isError ? errorMessage(list.error) : null} onRetry={() => void list.refetch()} getRowId={(r) => r.id} onRowClick={(r) => setOpen(r.id)} hideSearch
        emptyTitle="No counts yet" emptyDescription="Start a count at the end of the week or month to keep the numbers honest." />
      {starting && <StartCount onClose={() => setStarting(false)} onStarted={(id) => { setStarting(false); setOpen(id); }} />}
      {open && <CountSheet id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function StartCount({ onClose, onStarted }: { onClose: () => void; onStarted: (id: string) => void }) {
  const { locationId, setLocationId, locations } = useLocationChoice();
  const invalidate = useInvalidate();
  const start = useMutation({
    mutationFn: async () => (await api.post<{ data: { id: string } }>("/stock-counts", { locationId })).data,
    onSuccess: async (c) => { await invalidate("/stock-counts"); onStarted(c.id); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Start a count</DialogTitle><DialogDescription>Every active item at the location is listed. Enter what you find on the shelf.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label>Location</Label><LocationSelect className="w-full" value={locationId} onChange={setLocationId} locations={locations} /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!locationId || start.isPending} onClick={() => start.mutate()}>Start</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CountSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { me, can } = useAuth();
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: ["/stock-counts", "one", id], queryFn: async () => (await api.get<{ data: CountDetail }>(`/stock-counts/${id}`)).data });
  const [entered, setEntered] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const loc = (me?.locations ?? []).find((l) => l.id === q.data?.locationId);
  const { money } = useMoney(loc?.currencyCode);
  const c = q.data;
  const editable = c?.status === "DRAFT";
  const blind = editable; // the system quantity stays hidden while counting, so the number written down is the real one
  const valueOf = (l: CountLine) => entered[l.itemId] ?? (l.countedQty === null ? "" : String(l.countedQty));
  const changed = () => (c?.lines ?? []).filter((l) => entered[l.itemId] !== undefined).map((l) => ({ itemId: l.itemId, countedQty: entered[l.itemId] === "" ? null : Number(entered[l.itemId]) }));
  const done = async () => { await invalidate("/stock-counts", "/inventory"); onClose(); };

  const save = useMutation({ mutationFn: async () => { const lines = changed(); if (lines.length) await api.put(`/stock-counts/${id}/lines`, { lines }); }, onSuccess: async () => { setEntered({}); await q.refetch(); toast.success("Progress saved"); }, onError: (e) => toast.error(errorMessage(e)) });
  const submit = useMutation({ mutationFn: async () => { const lines = changed(); if (lines.length) await api.put(`/stock-counts/${id}/lines`, { lines }); await api.post(`/stock-counts/${id}/submit`, {}); }, onSuccess: async () => { toast.success("Count submitted for approval"); await done(); }, onError: (e) => toast.error(errorMessage(e)) });
  const approve = useMutation({ mutationFn: () => api.post<{ data: { adjusted: number } }>(`/stock-counts/${id}/approve`, {}), onSuccess: async (r) => { toast.success(`Approved: ${r.data.adjusted} item${r.data.adjusted === 1 ? "" : "s"} corrected`); await done(); }, onError: (e) => toast.error(errorMessage(e)) });
  const cancel = useMutation({ mutationFn: () => api.post(`/stock-counts/${id}/cancel`, {}), onSuccess: done, onError: (e) => toast.error(errorMessage(e)) });
  const busy = save.isPending || submit.isPending || approve.isPending || cancel.isPending;
  const shown = (c?.lines ?? []).filter((l) => l.item.name.toLowerCase().includes(filter.toLowerCase()));
  const countedNow = (c?.lines ?? []).filter((l) => valueOf(l) !== "").length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader><DialogTitle>{c ? `${c.number} · ${c.location.name}` : "Count"}</DialogTitle><DialogDescription>{editable ? `Counted ${countedNow} of ${c?.lines.length ?? 0}. Leave an item blank if you did not count it.` : "Differences are applied to stock when a manager approves."}</DialogDescription></DialogHeader>
        {!c ? <Skeleton className="h-40 w-full" /> : (
          <>
            <Input placeholder="Filter items…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter items" />
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader><TableRow><TableHead>Item</TableHead>{!blind && <TableHead className="text-right">System</TableHead>}<TableHead className="w-40 text-right">Counted</TableHead>{!blind && <TableHead className="text-right">Difference</TableHead>}</TableRow></TableHeader>
                <TableBody>
                  {shown.map((l) => {
                    const v = valueOf(l);
                    const diff = v === "" ? null : Number(v) - l.expectedQty;
                    return (
                      <TableRow key={l.id}>
                        <TableCell><div className="font-medium">{l.item.name}</div>{l.item.category && <div className="text-xs text-muted-foreground">{l.item.category}</div>}</TableCell>
                        {!blind && <TableCell className="text-right tabular-nums">{fmtQty(l.expectedQty)} {l.item.unit}</TableCell>}
                        <TableCell className="text-right">{editable ? <div className="relative ml-auto w-32"><Input inputMode="decimal" aria-label={`Counted ${l.item.name}`} value={v} onChange={(e) => setEntered((s) => ({ ...s, [l.itemId]: e.target.value }))} className="pr-9 text-right" /><span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{l.item.unit}</span></div> : <span className="tabular-nums">{l.countedQty === null ? "-" : `${fmtQty(l.countedQty)} ${l.item.unit}`}</span>}</TableCell>
                        {!blind && <TableCell className={`text-right tabular-nums ${diff !== null && diff < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{diff === null ? "-" : `${diff > 0 ? "+" : ""}${fmtQty(diff)} (${money(diff * l.unitCost)})`}</TableCell>}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <DialogFooter className="sm:justify-between">
              {c.status !== "APPROVED" && c.status !== "CANCELLED" ? <Button variant="ghost" disabled={busy} onClick={() => cancel.mutate()}>Cancel count</Button> : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Close</Button>
                {editable && <Button variant="outline" disabled={busy || changed().length === 0} onClick={() => save.mutate()}>Save progress</Button>}
                {editable && <Button disabled={busy || countedNow === 0} onClick={() => submit.mutate()}>Submit for approval</Button>}
                {c.status === "SUBMITTED" && can("inventory.count.approve") && <Button disabled={busy} onClick={() => approve.mutate()}>Approve and correct stock</Button>}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
