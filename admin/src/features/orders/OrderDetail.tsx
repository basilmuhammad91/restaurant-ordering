import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Printer, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Can } from "@/components/Can";
import { ErrorState, LoadingRows } from "@/components/page/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useApproval } from "@/features/pos/approval";
import { money } from "@/features/pos/cart";
import { ReceiptDialog, taxByAuthority } from "@/features/pos/Receipt";
import type { PosContext, PosOrder, PosOrderLine } from "@/features/pos/types";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fromMinor, toMinor } from "@/lib/money";
import { PaymentBadge, StatusBadge, TYPE_LABEL } from "./common";

/** One order, in full: what was sold, what was paid, what happened to it, and the actions a manager may take. */
export function OrderDetail({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const order = useQuery({ queryKey: ["/orders", "detail", orderId], queryFn: async () => (await api.get<{ data: PosOrder }>(`/orders/${orderId}`)).data });
  const o = order.data;
  const ctx = useQuery({ queryKey: ["/pos/context", o?.locationId], enabled: !!o, queryFn: async () => (await api.get<{ data: PosContext }>("/pos/context", { locationId: o!.locationId })).data });
  const fmt = { symbol: ctx.data?.currency.symbol ?? "", exponent: ctx.data?.currency.exponent ?? 2 };
  const { guard, dialog } = useApproval();
  const refresh = () => { void order.refetch(); void qc.invalidateQueries({ queryKey: ["/orders"] }); };

  const [voiding, setVoiding] = useState<PosOrderLine | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState("");

  const voidLine = useMutation({
    mutationFn: (line: PosOrderLine) => guard((approvalId) => api.post(`/orders/${orderId}/lines/${line.id}/void`, { reasonId, note: note.trim() || undefined, ...(approvalId ? { approvalId } : {}) })),
    onSuccess: () => { toast.success("Item voided"); setVoiding(null); setReasonId(""); setNote(""); refresh(); },
    onError: (e) => { if (!(e instanceof ApiError && e.code === "APPROVAL_DECLINED")) toast.error(errorMessage(e)); },
  });
  const refund = useMutation({
    mutationFn: () => guard((approvalId) => api.post(`/orders/${orderId}/refund`, { amountMinor: toMinor(amount, fmt.exponent), paymentMethodId: methodId, reasonId, note: note.trim() || undefined, ...(approvalId ? { approvalId } : {}) })),
    onSuccess: () => { toast.success("Refund recorded"); setRefunding(false); setReasonId(""); setNote(""); setAmount(""); refresh(); },
    onError: (e) => { if (!(e instanceof ApiError && e.code === "APPROVAL_DECLINED")) toast.error(errorMessage(e)); },
  });

  const m = (n: number) => money(n, fmt);
  const refundable = o ? o.paidMinor - o.refundedMinor : 0;
  const closed = o ? o.status === "CANCELLED" || o.status === "COMPLETED" : true;
  const reasonPicker = (list: { id: string; name: string }[] | undefined) => (
    <div className="flex flex-wrap gap-2">{(list ?? []).map((r) => <button key={r.id} type="button" aria-pressed={r.id === reasonId} onClick={() => setReasonId(r.id)} className={`rounded-lg border px-3 py-1.5 text-sm ${r.id === reasonId ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>{r.name}</button>)}</div>
  );

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{o ? `Order ${o.orderNumber}` : "Order"}</SheetTitle>
          <SheetDescription>{o ? `${TYPE_LABEL[o.orderType]} · ${format(new Date(o.occurredAt), "d MMM yyyy, HH:mm")} · ${o.location.name}` : "Loading…"}</SheetDescription>
        </SheetHeader>
        {order.isPending ? <div className="p-4"><LoadingRows /></div> : order.isError || !o ? <div className="p-4"><ErrorState message={errorMessage(order.error)} onRetry={() => void order.refetch()} /></div> : (
          <div className="space-y-5 px-4 pb-6">
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={o.status} /><PaymentBadge status={o.paymentStatus} />{o.channel !== "POS" && <Badge variant="secondary">{o.channel}</Badge>}{o.customerName && <span className="text-sm text-muted-foreground">{o.customerName}{o.customerPhone ? ` · ${o.customerPhone}` : ""}</span>}</div>
            {o.notes && <p className="rounded-md bg-muted/50 p-2 text-sm">“{o.notes}”</p>}

            <section aria-label="Items">
              <h3 className="mb-1 text-sm font-semibold">Items</h3>
              <ul className="divide-y rounded-lg border">
                {o.lines.map((l) => (
                  <li key={l.id} className={`px-3 py-2 text-sm ${l.status === "VOIDED" ? "text-muted-foreground line-through" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div><div className="font-medium">{l.quantity} × {l.nameSnapshot}{l.variantNameSnapshot ? ` (${l.variantNameSnapshot})` : ""}</div>
                        {l.modifiers.length > 0 && <div className="text-xs text-muted-foreground">{l.modifiers.map((x) => x.nameSnapshot).join(", ")}</div>}
                        {l.children.length > 0 && <div className="text-xs text-muted-foreground">{l.children.map((c) => `${c.quantity} × ${c.nameSnapshot}`).join(" · ")}</div>}
                        {l.notes && <div className="text-xs italic text-muted-foreground">“{l.notes}”</div>}</div>
                      <div className="flex items-center gap-2"><span className="tabular-nums">{m(l.lineSubtotalMinor)}</span>
                        {!closed && l.status !== "VOIDED" && <Can permission="orders.void"><Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => setVoiding(l)}>Void</Button></Can>}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-label="Totals" className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{m(o.subtotalMinor)}</span></div>
              {o.discountMinor > 0 && <div className="flex justify-between text-emerald-700 dark:text-emerald-400"><span>Discount</span><span className="tabular-nums">-{m(o.discountMinor)}</span></div>}
              {o.deliveryFeeMinor > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Delivery</span><span className="tabular-nums">{m(o.deliveryFeeMinor)}</span></div>}
              {taxByAuthority(o).map((t) => <div key={`${t.authorityCode}${t.rateBp}`} className="flex justify-between"><span className="text-muted-foreground">{t.name} {t.rateBp / 100}%{o.pricesIncludeTax ? " (included)" : ""}</span><span className="tabular-nums">{m(t.taxMinor)}</span></div>)}
              <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Total</span><span className="tabular-nums">{m(o.totalMinor)}</span></div>
              {o.tipMinor > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tip</span><span className="tabular-nums">{m(o.tipMinor)}</span></div>}
            </section>

            <section aria-label="Payments">
              <h3 className="mb-1 text-sm font-semibold">Payments</h3>
              {o.payments.length === 0 && o.refunds.length === 0 ? <p className="text-sm text-muted-foreground">Nothing paid yet.</p> : (
                <ul className="divide-y rounded-lg border text-sm">
                  {o.payments.map((p) => <li key={p.id} className="flex justify-between px-3 py-2"><span>{p.paymentMethod.name}{p.reference ? ` · ${p.reference}` : ""}<span className="block text-xs text-muted-foreground">{format(new Date(p.occurredAt), "HH:mm")}{p.changeMinor > 0 ? ` · change ${m(p.changeMinor)}` : ""}{p.tipMinor > 0 ? ` · tip ${m(p.tipMinor)}` : ""}</span></span><span className="tabular-nums">{m(p.amountMinor)}</span></li>)}
                  {o.refunds.map((r) => <li key={r.id} className="flex justify-between px-3 py-2 text-destructive"><span>Refund · {r.paymentMethod.name}{r.note ? ` · ${r.note}` : ""}</span><span className="tabular-nums">-{m(r.amountMinor)}</span></li>)}
                </ul>
              )}
            </section>

            <section aria-label="History">
              <h3 className="mb-1 text-sm font-semibold">History</h3>
              <ol className="space-y-1 text-sm">{o.events.map((e) => <li key={e.id} className="flex justify-between text-muted-foreground"><span>{e.fromStatus ? `${e.fromStatus.toLowerCase().replace(/_/g, " ")} → ` : ""}<span className="text-foreground">{e.toStatus.toLowerCase().replace(/_/g, " ")}</span>{e.note ? ` · ${e.note}` : ""}</span><span className="tabular-nums">{format(new Date(e.at), "HH:mm")}</span></li>)}</ol>
            </section>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setReceipt(true)}><Printer /> Receipt</Button>
              {refundable > 0 && <Can permission="orders.refund"><Button variant="outline" onClick={() => { setAmount(fromMinor(refundable, fmt.exponent)); setMethodId(ctx.data?.paymentMethods[0]?.id ?? ""); setRefunding(true); }}><Undo2 /> Refund</Button></Can>}
            </div>
          </div>
        )}
      </SheetContent>

      <Dialog open={!!voiding} onOpenChange={(open) => !open && setVoiding(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Void {voiding?.nameSnapshot}?</DialogTitle><DialogDescription>The item is removed and the totals are recalculated. Bigger voids need a manager.</DialogDescription></DialogHeader>
          {reasonPicker(ctx.data?.reasons.void)}
          <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter><Button variant="outline" onClick={() => setVoiding(null)}>Keep item</Button><Button variant="destructive" disabled={!reasonId || voidLine.isPending} onClick={() => voiding && voidLine.mutate(voiding)}>{voidLine.isPending ? "Voiding…" : "Void item"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={refunding} onOpenChange={setRefunding}>
        <DialogContent>
          <DialogHeader><DialogTitle>Refund</DialogTitle><DialogDescription>Up to {m(refundable)} can be refunded on this order.</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="refund-amount">Amount</Label><Input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11 text-lg" /></div>
          <div className="space-y-1.5"><Label>Refund to</Label><div className="flex flex-wrap gap-2">{(ctx.data?.paymentMethods ?? []).map((p) => <button key={p.id} type="button" aria-pressed={p.id === methodId} onClick={() => setMethodId(p.id)} className={`rounded-lg border px-3 py-1.5 text-sm ${p.id === methodId ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>{p.name}</button>)}</div></div>
          <div className="space-y-1.5"><Label>Reason</Label>{reasonPicker(ctx.data?.reasons.refund)}</div>
          <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter><Button variant="outline" onClick={() => setRefunding(false)}>Cancel</Button><Button disabled={!reasonId || !methodId || toMinor(amount, fmt.exponent) === null || refund.isPending} onClick={() => refund.mutate()}>{refund.isPending ? "Refunding…" : "Refund"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {receipt && o && <ReceiptDialog order={o} fmt={fmt} onClose={() => setReceipt(false)} />}
      {dialog}
    </Sheet>
  );
}
