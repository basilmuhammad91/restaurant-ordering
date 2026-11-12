import { useMutation, useQuery } from "@tanstack/react-query";
import { Bike, MapPin, Phone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page/PageHeader";
import { ErrorState } from "@/components/page/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SimpleSelect } from "@/features/menu/shared";
import { StatusBadge, useBranches, useMinutesSince } from "@/features/orders/common";
import { api, errorMessage, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor, useCurrencies } from "@/lib/money";
import { useInvalidate } from "@/lib/queries";

interface Delivery {
  id: string; orderNumber: string; status: string; paymentStatus: string; customerName: string | null; customerPhone: string | null; deliveryAddress: { line1?: string; area?: string; city?: string; instructions?: string } | null;
  totalMinor: number; paidMinor: number; currencyCode: string; placedAt: string; locationName: string;
  delivery: { id: string; riderId: string; riderName: string; riderPhone: string | null; status: "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "FAILED"; failedReason: string | null } | null;
}
const TABS = [["unassigned", "Needs a rider"], ["active", "On the road"], ["done", "Delivered"], ["all", "All"]] as const;
const DSTATUS = { ASSIGNED: ["Rider assigned", "bg-sky-500/15 text-sky-700 dark:text-sky-400"], PICKED_UP: ["On the way", "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400"], DELIVERED: ["Delivered", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"], FAILED: ["Failed", "bg-red-500/15 text-red-700 dark:text-red-400"] } as const;

/** The dispatcher's board: give each delivery order to a rider, then follow it until it is handed over. */
export default function DeliveriesPage() {
  const { can } = useAuth();
  const branches = useBranches();
  const [state, setState] = useState<(typeof TABS)[number][0]>("unassigned");
  const [locationId, setLocationId] = useState("");
  const [assigning, setAssigning] = useState<Delivery | null>(null);
  const [failing, setFailing] = useState<Delivery | null>(null);
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: ["/deliveries", state, locationId], refetchInterval: 15_000, queryFn: async () => (await api.get<{ data: Delivery[] }>("/deliveries", { state, ...(locationId ? { locationId } : {}) })).data });
  const move = useMutation({
    mutationFn: ({ id, step }: { id: string; step: "pickup" | "deliver" }) => api.post<{ data: { needsPayment: boolean } }>(`/deliveries/${id}/${step}`, {}),
    onSuccess: async (r, v) => { toast.success(v.step === "pickup" ? "Marked as picked up" : r.data.needsPayment ? "Delivered. Collect the payment, then complete the order." : "Delivered"); await invalidate("/deliveries", "/orders"); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader title="Deliveries" description="Delivery orders and who is bringing them. Refreshes every few seconds."
        actions={<SimpleSelect className="w-48" allowEmpty emptyLabel="All branches" value={locationId} onChange={setLocationId} label="Branch" options={branches.map((b) => ({ value: b.id, label: b.name }))} />} />
      <div className="mb-4 inline-flex flex-wrap rounded-lg border p-0.5" role="tablist">{TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={state === k} onClick={() => setState(k)} className={`rounded-md px-3 py-1.5 text-sm ${state === k ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{label}</button>)}</div>
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : q.isPending ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
        : q.data.length === 0 ? <div className="rounded-xl border bg-card p-10 text-center text-muted-foreground"><Bike className="mx-auto mb-2 size-8" />{state === "unassigned" ? "Every delivery has a rider." : "Nothing here."}</div>
        : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {q.data.map((d) => <Card key={d.id} d={d} canAssign={can("delivery.assign")} busy={move.isPending} onAssign={() => setAssigning(d)} onMove={(step) => move.mutate({ id: d.id, step })} onFail={() => setFailing(d)} />)}
          </div>
        )}
      {assigning && <AssignDialog d={assigning} onClose={() => setAssigning(null)} />}
      {failing && <FailDialog d={failing} onClose={() => setFailing(null)} />}
    </>
  );
}

function Card({ d, canAssign, busy, onAssign, onMove, onFail }: { d: Delivery; canAssign: boolean; busy: boolean; onAssign: () => void; onMove: (s: "pickup" | "deliver") => void; onFail: () => void }) {
  const { exponent } = useCurrencies();
  const mins = useMinutesSince(d.placedAt);
  const a = d.delivery;
  const address = [d.deliveryAddress?.line1, d.deliveryAddress?.area, d.deliveryAddress?.city].filter(Boolean).join(", ");
  const unpaid = d.paidMinor < d.totalMinor;
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2"><div><div className="font-semibold">{d.orderNumber}</div><div className="text-xs text-muted-foreground">{d.locationName} · {mins} min ago</div></div><StatusBadge status={d.status} /></div>
      <div className="text-sm"><div className="font-medium">{d.customerName ?? "Customer"}</div>
        {d.customerPhone && <div className="flex items-center gap-1 text-muted-foreground"><Phone className="size-3.5" /> {d.customerPhone}</div>}
        <div className="flex items-start gap-1 text-muted-foreground"><MapPin className="mt-0.5 size-3.5 shrink-0" /> {address || "No address"}</div>
        {d.deliveryAddress?.instructions && <div className="text-xs italic text-muted-foreground">{d.deliveryAddress.instructions}</div>}</div>
      <div className="flex items-center justify-between text-sm"><span className="font-semibold tabular-nums">{formatMinor(d.totalMinor, d.currencyCode, exponent(d.currencyCode))}</span>{unpaid ? <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-400">Collect on delivery</Badge> : <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Paid</Badge>}</div>
      {a && <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm"><span className="flex items-center gap-1.5"><Bike className="size-4" /> {a.riderName}{a.riderPhone ? ` · ${a.riderPhone}` : ""}</span><Badge variant="secondary" className={DSTATUS[a.status][1]}>{DSTATUS[a.status][0]}</Badge></div>}
      {a?.status === "FAILED" && <p className="text-xs text-destructive">Failed: {a.failedReason}</p>}
      {canAssign && d.status !== "COMPLETED" && (
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {(!a || a.status === "FAILED" || a.status === "ASSIGNED") && <Button size="sm" variant={a && a.status !== "FAILED" ? "outline" : "default"} onClick={onAssign}>{a && a.status !== "FAILED" ? "Change rider" : "Assign a rider"}</Button>}
          {a?.status === "ASSIGNED" && <Button size="sm" disabled={busy} onClick={() => onMove("pickup")}>Picked up</Button>}
          {a?.status === "PICKED_UP" && <Button size="sm" disabled={busy} onClick={() => onMove("deliver")}>Delivered</Button>}
          {(a?.status === "ASSIGNED" || a?.status === "PICKED_UP") && <Button size="sm" variant="ghost" onClick={onFail}>Failed</Button>}
        </div>
      )}
    </div>
  );
}

function AssignDialog({ d, onClose }: { d: Delivery; onClose: () => void }) {
  const invalidate = useInvalidate();
  const riders = useQuery({ queryKey: ["/riders", "active"], queryFn: async () => (await api.get<Paged<{ id: string; name: string; vehicle: string | null }>>("/riders", { isActive: true, pageSize: 100 })).data });
  const [riderId, setRiderId] = useState(d.delivery?.riderId ?? "");
  const save = useMutation({ mutationFn: () => api.post(`/deliveries/${d.id}/assign`, { riderId }), onSuccess: async () => { toast.success("Rider assigned"); await invalidate("/deliveries"); onClose(); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Assign a rider to {d.orderNumber}</DialogTitle><DialogDescription>{riders.data?.length === 0 ? "No riders yet. Add them under Delivery > Riders." : "Choose who will deliver it."}</DialogDescription></DialogHeader>
        <SimpleSelect value={riderId} onChange={setRiderId} label="Rider" options={(riders.data ?? []).map((r) => ({ value: r.id, label: `${r.name}${r.vehicle ? ` (${r.vehicle})` : ""}` }))} placeholder="Choose a rider" />
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!riderId || save.isPending} onClick={() => save.mutate()}>Assign</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FailDialog({ d, onClose }: { d: Delivery; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => api.post(`/deliveries/${d.id}/fail`, { reason: reason.trim() }), onSuccess: async () => { toast.success("Marked as failed. You can assign it again."); await invalidate("/deliveries"); onClose(); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Delivery failed</DialogTitle><DialogDescription>{d.orderNumber}. What went wrong?</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label htmlFor="fail-why">Reason</Label><Input id="fail-why" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Customer not answering, wrong address…" /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="destructive" disabled={!reason.trim() || save.isPending} onClick={() => save.mutate()}>Mark as failed</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
