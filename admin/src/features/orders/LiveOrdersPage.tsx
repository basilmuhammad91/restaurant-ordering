import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bike, ShoppingBag, Utensils, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page/PageHeader";
import { ErrorState } from "@/components/page/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/features/menu/shared";
import { useApproval } from "@/features/pos/approval";
import type { PosContext, PosOrder } from "@/features/pos/types";
import { ApiError, api, errorMessage, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor, useCurrencies } from "@/lib/money";
import { PaymentBadge, STATUS_LABEL, TYPE_LABEL, useBranches, useMinutesSince } from "./common";

// LIVE ORDERS: every order being worked on, as columns that match what is happening. One tap moves an order to
// its next step. Refreshes by itself every few seconds, so the screen stays true without anyone reloading.

const COLUMNS = ["PENDING", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] as const;
const NEXT: Record<string, { to: string; label: string }> = {
  PENDING: { to: "CONFIRMED", label: "Accept" }, CONFIRMED: { to: "PREPARING", label: "Start" }, PREPARING: { to: "READY", label: "Ready" },
  READY: { to: "COMPLETED", label: "Complete" }, OUT_FOR_DELIVERY: { to: "COMPLETED", label: "Delivered" },
};
const TYPE_ICON = { DINE_IN: Utensils, TAKEAWAY: ShoppingBag, DELIVERY: Bike } as const;

function Card({ order, onAdvance, onCancel, busy, canUpdate, canCancel, fmt }: { order: PosOrder; onAdvance: (o: PosOrder, to: string) => void; onCancel: (o: PosOrder) => void; busy: boolean; canUpdate: boolean; canCancel: boolean; fmt: (n: number, c: string) => string }) {
  const minutes = useMinutesSince(order.placedAt);
  const Icon = TYPE_ICON[order.orderType as keyof typeof TYPE_ICON] ?? ShoppingBag;
  const next = order.status === "READY" && order.orderType === "DELIVERY" ? { to: "OUT_FOR_DELIVERY", label: "Send out" } : NEXT[order.status];
  const items = order.lines.filter((l) => l.kind !== "COMBO_ITEM" && l.status !== "VOIDED");
  const due = order.totalMinor - order.paidMinor;
  const late = minutes >= 20 && order.status !== "READY" && order.status !== "OUT_FOR_DELIVERY";
  return (
    <li className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div><div className="flex items-center gap-1.5 font-semibold"><Icon className="size-4 text-muted-foreground" /> {order.orderNumber}</div><div className="text-xs text-muted-foreground">{TYPE_LABEL[order.orderType]}{order.customerName ? ` · ${order.customerName}` : ""}</div></div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${late ? "bg-red-500/15 text-red-700 dark:text-red-400" : "bg-muted text-muted-foreground"}`}>{minutes} min</span>
      </div>
      <ul className="mt-2 space-y-0.5 text-sm">
        {items.slice(0, 4).map((l) => <li key={l.id} className="truncate">{l.quantity} × {l.nameSnapshot}{l.variantNameSnapshot ? ` (${l.variantNameSnapshot})` : ""}</li>)}
        {items.length > 4 && <li className="text-xs text-muted-foreground">+ {items.length - 4} more</li>}
      </ul>
      <div className="mt-2 flex items-center justify-between text-sm"><span className="font-semibold tabular-nums">{fmt(order.totalMinor, order.currencyCode)}</span><PaymentBadge status={order.paymentStatus} /></div>
      {due > 0 && order.paymentStatus !== "UNPAID" && <div className="text-xs text-amber-700 dark:text-amber-400">due {fmt(due, order.currencyCode)}</div>}
      {(canUpdate || canCancel) && (
        <div className="mt-2 flex gap-1.5">
          {canUpdate && next && <Button size="sm" className="flex-1" disabled={busy} onClick={() => onAdvance(order, next.to)}>{next.label} <ArrowRight /></Button>}
          {canCancel && <Button size="icon" variant="outline" className="size-8" aria-label={`Cancel ${order.orderNumber}`} disabled={busy || order.paidMinor > 0} title={order.paidMinor > 0 ? "Paid orders are refunded, not cancelled" : "Cancel order"} onClick={() => onCancel(order)}><X /></Button>}
        </div>
      )}
    </li>
  );
}

export default function LiveOrdersPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const branches = useBranches();
  const { exponent } = useCurrencies();
  const [locationId, setLocationId] = useState("");
  const [cancelling, setCancelling] = useState<PosOrder | null>(null);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const { guard, dialog } = useApproval();

  const list = useQuery({
    queryKey: ["/orders", "live", locationId], refetchInterval: 8_000,
    queryFn: async () => (await api.get<Paged<PosOrder>>("/orders", { ...(locationId ? { locationId } : {}), active: "true", pageSize: 100, sort: "placedAt" })).data,
  });
  const reasonsLocation = cancelling?.locationId ?? "";
  const reasons = useQuery({ queryKey: ["/pos/context", reasonsLocation], enabled: !!reasonsLocation, queryFn: async () => (await api.get<{ data: PosContext }>("/pos/context", { locationId: reasonsLocation })).data.reasons.void });

  const fmt = (n: number, c: string) => formatMinor(n, c, exponent(c));
  const move = useMutation({
    mutationFn: ({ order, to }: { order: PosOrder; to: string }) => api.post(`/orders/${order.id}/status`, { status: to }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/orders"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: (order: PosOrder) => guard((approvalId) => api.post(`/orders/${order.id}/status`, { status: "CANCELLED", reasonId, note: note.trim() || undefined, ...(approvalId ? { approvalId } : {}) })),
    onSuccess: () => { toast.success("Order cancelled"); setCancelling(null); setReasonId(""); setNote(""); void qc.invalidateQueries({ queryKey: ["/orders"] }); },
    onError: (e) => { if (!(e instanceof ApiError && e.code === "APPROVAL_DECLINED")) toast.error(errorMessage(e)); },
  });

  const orders = list.data ?? [];
  const held = orders.filter((o) => o.status === "OPEN").length;

  return (
    <>
      <PageHeader title="Live orders" description="Everything being worked on right now. Tap the button on a card to move it along." actions={
        <div className="w-56"><SimpleSelect value={locationId} onChange={setLocationId} allowEmpty emptyLabel="All my branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} label="Branch" /></div>
      } />
      {list.isError ? <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} /> : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {COLUMNS.map((s) => {
              const col = orders.filter((o) => o.status === s);
              return (
                <section key={s} aria-label={STATUS_LABEL[s]} className="min-w-0">
                  <h2 className="mb-2 flex items-center justify-between text-sm font-semibold"><span>{STATUS_LABEL[s]}</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{col.length}</span></h2>
                  <ul className="space-y-2">
                    {col.length === 0 && <li className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">None</li>}
                    {col.map((o) => <Card key={o.id} order={o} fmt={fmt} busy={move.isPending} canUpdate={can("orders.update")} canCancel={can("orders.cancel")} onAdvance={(order, to) => move.mutate({ order, to })} onCancel={(order) => setCancelling(order)} />)}
                  </ul>
                </section>
              );
            })}
          </div>
          {held > 0 && <p className="mt-4 text-sm text-muted-foreground">{held} held bill{held === 1 ? "" : "s"} are waiting at the till (open them from the POS).</p>}
        </>
      )}

      <Dialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel {cancelling?.orderNumber}?</DialogTitle><DialogDescription>The items are voided. Say why: it is kept in the audit log.</DialogDescription></DialogHeader>
          <div className="flex flex-wrap gap-2">{(reasons.data ?? []).map((r) => <button key={r.id} type="button" aria-pressed={r.id === reasonId} onClick={() => setReasonId(r.id)} className={`rounded-lg border px-3 py-1.5 text-sm ${r.id === reasonId ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>{r.name}</button>)}</div>
          <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter><Button variant="outline" onClick={() => setCancelling(null)}>Keep order</Button><Button variant="destructive" disabled={!reasonId || cancel.isPending} onClick={() => cancelling && cancel.mutate(cancelling)}>{cancel.isPending ? "Cancelling…" : "Cancel order"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
