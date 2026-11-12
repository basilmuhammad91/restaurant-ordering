import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Banknote, FileText, Lock, Plus, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Can } from "@/components/Can";
import { fmtDateTime, titleCase } from "@/components/cells";
import { PageHeader } from "@/components/page/PageHeader";
import { ErrorState, LoadingRows } from "@/components/page/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SimpleSelect } from "@/features/menu/shared";
import { money } from "@/features/pos/cart";
import type { PosContext } from "@/features/pos/types";
import { api, errorMessage } from "@/lib/api";
import { toMinor, useCurrencies } from "@/lib/money";
import { useBranches } from "./common";

// SHIFTS AND CASH. Open a shift with a float, take cash and card, record cash in/out and safe drops, then
// close by counting the drawer. The system compares your count with what SHOULD be there and records the
// difference, then stores an end-of-shift (Z) report that can never be changed.

interface Figures { openingFloatMinor: number; cashSalesMinor: number | null; cashRefundsMinor: number | null; cashInMinor: number; cashOutMinor: number; paidOutMinor: number; safeDropsMinor: number; expectedCashMinor: number | null }
interface Movement { id: string; type: string; amountMinor: number; note: string | null; occurredAt: string }
interface Shift {
  id: string; locationId: string; businessDate: string; status: "OPEN" | "CLOSED"; currencyCode: string; openedAt: string; openingFloatMinor: number; closedAt: string | null; expectedCashMinor: number | null; countedCashMinor: number | null;
  varianceMinor: number | null; isBlindClose: boolean; notes: string | null; registerName: string | null; locationName: string | null; openedByName: string | null; closedByName: string | null; figures: Figures; movements: Movement[];
}
interface ShiftRow extends Omit<Shift, "figures" | "movements"> { zReportId: string | null }

const MOVEMENT_LABEL: Record<string, string> = { CASH_IN: "Cash in", CASH_OUT: "Cash out", PAID_OUT: "Paid out", SAFE_DROP: "Safe drop" };

function Tile({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-xl border bg-card p-3"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>{value}</div></div>;
}

const varianceTone = (v: number | null) => (v === null || v === 0 ? "" : v < 0 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400");
const varianceText = (v: number | null, f: { symbol: string; exponent: number }) => (v === null ? "-" : v === 0 ? "Exact" : `${v < 0 ? "Short" : "Over"} ${money(Math.abs(v), f)}`);

/** The stored end-of-shift or end-of-day report. Read-only: it is a snapshot of what the numbers were. */
export function ZReportDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { exponent } = useCurrencies();
  const q = useQuery({ queryKey: ["/z-reports", id], queryFn: async () => (await api.get<{ data: { id: string; scope: string; businessDate: string; generatedAt: string; data: any } }>(`/z-reports/${id}`)).data });
  const z = q.data;
  const cur = z?.data.location?.currencyCode ?? "PKR";
  const fmt = { symbol: cur === "PKR" ? "Rs." : cur, exponent: exponent(cur) };
  const m = (n: number | null | undefined) => money(n ?? 0, fmt);
  const s = z?.data.sales;
  const cash = z?.data.cash;
  const row = (label: string, value: string, strong = false) => <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}><span className={strong ? "" : "text-muted-foreground"}>{label}</span><span className="tabular-nums">{value}</span></div>;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{z?.scope === "DAY" ? "End-of-day report (Z)" : "End-of-shift report (Z)"}</DialogTitle><DialogDescription>{z ? `${z.data.location?.name ?? ""} · trading day ${z.businessDate} · taken ${fmtDateTime(z.generatedAt)}` : "Loading…"}</DialogDescription></DialogHeader>
        {q.isPending ? <LoadingRows rows={4} /> : q.isError || !z ? <ErrorState message={errorMessage(q.error)} /> : (
          <div className="space-y-4 text-sm" id="z-print">
            {z.data.note && <p className="rounded-md bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">{z.data.note}</p>}
            {s ? (
              <>
                <section className="space-y-1"><h3 className="font-semibold">Sales</h3>
                  {row("Orders", String(s.orders))}{row("Gross sales", m(s.grossSalesMinor))}{row("Discounts", `-${m(s.discountsMinor)}`)}{row("Net sales (before tax)", m(s.netSalesMinor), true)}
                  {row("Tax", m(s.taxMinor))}{s.deliveryFeesMinor > 0 && row("Delivery fees", m(s.deliveryFeesMinor))}{row("Total sales", m(s.totalMinor), true)}{s.tipsMinor > 0 && row("Tips", m(s.tipsMinor))}</section>
                <section className="space-y-1"><h3 className="font-semibold">By payment method</h3>
                  {s.byPaymentMethod.length === 0 ? <p className="text-muted-foreground">No payments.</p> : s.byPaymentMethod.map((p: any) => row(`${p.name} (${p.count})`, m(p.amountMinor)))}{row("Collected", m(s.collectedMinor), true)}</section>
                <section className="space-y-1"><h3 className="font-semibold">By order type</h3>
                  {Object.entries(s.byOrderType).map(([k, v]: [string, any]) => row(`${titleCase(k)} (${v.orders})`, m(v.totalMinor)))}</section>
                <section className="space-y-1"><h3 className="font-semibold">Voids, refunds, cancellations</h3>
                  {row(`Voided items (${s.voids.lines})`, m(s.voids.amountMinor))}{row(`Refunds (${s.refunds.count})`, m(s.refunds.amountMinor))}{row(`Cancelled orders (${s.cancelled.orders})`, m(s.cancelled.amountMinor))}</section>
              </>
            ) : <p className="text-muted-foreground">No sales in this period.</p>}
            {cash && (
              <section className="space-y-1"><h3 className="font-semibold">Cash drawer</h3>
                {row("Opening float", m(cash.openingFloatMinor))}{row("Cash sales", m(cash.cashSalesMinor))}{row("Cash refunds", `-${m(cash.cashRefundsMinor)}`)}{row("Cash in", m(cash.cashInMinor))}{row("Cash out", `-${m(cash.cashOutMinor)}`)}
                {row("Paid out", `-${m(cash.paidOutMinor)}`)}{row("Safe drops", `-${m(cash.safeDropsMinor)}`)}{row("Expected in drawer", m(cash.expectedCashMinor), true)}{row("Counted", m(cash.countedCashMinor), true)}
                <div className={`flex justify-between font-semibold ${varianceTone(cash.varianceMinor)}`}><span>Difference</span><span>{varianceText(cash.varianceMinor, fmt)}</span></div></section>
            )}
            {z.data.shifts?.length > 0 && (
              <section className="space-y-1"><h3 className="font-semibold">Shifts this day</h3>
                {z.data.shifts.map((sh: any) => <div key={sh.id} className="flex justify-between"><span className="text-muted-foreground">{sh.registerName} · {sh.openedByName}</span><span className={`tabular-nums ${varianceTone(sh.varianceMinor)}`}>{sh.status === "OPEN" ? "still open" : varianceText(sh.varianceMinor, fmt)}</span></div>)}</section>
            )}
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => window.print()}><Printer /> Print</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ShiftsPage() {
  const qc = useQueryClient();
  const branches = useBranches();
  const [locationId, setLocationId] = useState("");
  const branch = locationId || branches[0]?.id || "";
  const { exponent } = useCurrencies();
  const currency = branches.find((b) => b.id === branch)?.currencyCode ?? "PKR";
  const fmt = { symbol: currency === "PKR" ? "Rs." : currency, exponent: exponent(currency) };
  const m = (n: number | null | undefined) => money(n ?? 0, fmt);

  const current = useQuery({ queryKey: ["/shifts", "current", branch], enabled: !!branch, refetchInterval: 20_000, queryFn: async () => (await api.get<{ data: { shift: Shift | null } }>("/shifts/current", { locationId: branch })).data.shift });
  const ctx = useQuery({ queryKey: ["/pos/context", branch], enabled: !!branch, queryFn: async () => (await api.get<{ data: PosContext }>("/pos/context", { locationId: branch })).data });
  const history = useQuery({ queryKey: ["/shifts", "history", branch], enabled: !!branch, queryFn: async () => (await api.get<{ data: ShiftRow[] }>("/shifts", { locationId: branch, status: "CLOSED", pageSize: 20 })).data });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["/shifts"] });

  const [float, setFloat] = useState("");
  const [blind, setBlind] = useState(false);
  const [moveType, setMoveType] = useState<string | null>(null);
  const [moveAmount, setMoveAmount] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [moveNote, setMoveNote] = useState("");
  const [closing, setClosing] = useState(false);
  const [counted, setCounted] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [zId, setZId] = useState<string | null>(null);
  const [dayDate, setDayDate] = useState(() => format(new Date(), "yyyy-MM-dd"));

  const open = useMutation({
    mutationFn: () => api.post("/shifts/open", { locationId: branch, openingFloatMinor: toMinor(float || "0", fmt.exponent), isBlindClose: blind }),
    onSuccess: () => { toast.success("Shift opened"); setFloat(""); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const move = useMutation({
    mutationFn: (shiftId: string) => api.post(`/shifts/${shiftId}/movements`, { type: moveType, amountMinor: toMinor(moveAmount, fmt.exponent), ...(moveReason ? { reasonId: moveReason } : {}), note: moveNote.trim() || undefined }),
    onSuccess: () => { toast.success("Recorded"); setMoveType(null); setMoveAmount(""); setMoveReason(""); setMoveNote(""); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const close = useMutation({
    mutationFn: (shiftId: string) => api.post<{ data: { zReportId: string; shift: Shift } }>(`/shifts/${shiftId}/close`, { countedCashMinor: toMinor(counted, fmt.exponent), notes: closeNote.trim() || undefined }),
    onSuccess: (res) => { setClosing(false); setCounted(""); setCloseNote(""); toast.success(res.data.shift.varianceMinor === 0 ? "Shift closed: the drawer is exact" : `Shift closed: ${varianceText(res.data.shift.varianceMinor, fmt)}`); setZId(res.data.zReportId); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const day = useMutation({
    mutationFn: () => api.post<{ data: { id: string } }>("/z-reports/day", { locationId: branch, businessDate: dayDate }),
    onSuccess: (res) => setZId(res.data.id),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const shift = current.data;
  const needsReason = moveType === "CASH_OUT" || moveType === "PAID_OUT";

  return (
    <>
      <PageHeader title="Shifts & cash" description="Open the till, record cash movements, and count the drawer at the end of the shift." actions={<div className="w-56"><SimpleSelect value={branch} onChange={setLocationId} options={branches.map((b) => ({ value: b.id, label: b.name }))} label="Branch" /></div>} />

      {current.isError ? <ErrorState message={errorMessage(current.error)} onRetry={() => void current.refetch()} /> : current.isPending ? <LoadingRows rows={3} /> : !shift ? (
        <section className="mb-8 rounded-xl border bg-card p-5" aria-label="Open a shift">
          <h2 className="font-semibold">No shift is open</h2>
          <p className="mb-3 text-sm text-muted-foreground">Cash payments need an open shift. Count the drawer and enter the opening float.</p>
          <Can permission="shifts.open" fallback={<p className="text-sm text-muted-foreground">You do not have permission to open a shift.</p>}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5"><Label htmlFor="float">Opening float ({fmt.symbol})</Label><Input id="float" inputMode="decimal" className="w-44" placeholder="0" value={float} onChange={(e) => setFloat(e.target.value)} /></div>
              <label className="flex items-center gap-2 pb-2 text-sm"><Switch checked={blind} onCheckedChange={setBlind} aria-label="Blind close" /> Blind close <span className="text-xs text-muted-foreground">(hide the expected amount when counting)</span></label>
              <Button disabled={open.isPending || (float !== "" && toMinor(float, fmt.exponent) === null)} onClick={() => open.mutate()}><Banknote /> {open.isPending ? "Opening…" : "Open shift"}</Button>
            </div>
          </Can>
        </section>
      ) : (
        <section className="mb-8 space-y-4" aria-label="Current shift">
          <div className="flex flex-wrap items-center gap-2"><Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" variant="secondary">Open</Badge><span className="text-sm text-muted-foreground">{shift.registerName} · opened by {shift.openedByName} at {fmtDateTime(shift.openedAt)}{shift.isBlindClose && <span className="ml-2 inline-flex items-center gap-1"><Lock className="size-3" /> blind close</span>}</span></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Opening float" value={m(shift.figures.openingFloatMinor)} />
            <Tile label="Cash sales" value={shift.figures.cashSalesMinor === null ? "Hidden (blind)" : m(shift.figures.cashSalesMinor)} />
            <Tile label="Cash in / out" value={`${m(shift.figures.cashInMinor)} / ${m(shift.figures.cashOutMinor + shift.figures.paidOutMinor + shift.figures.safeDropsMinor)}`} />
            <Tile label="Expected in drawer" value={shift.figures.expectedCashMinor === null ? "Hidden (blind)" : m(shift.figures.expectedCashMinor)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Can permission="cash.manage">{(["CASH_IN", "CASH_OUT", "PAID_OUT", "SAFE_DROP"] as const).map((t) => <Button key={t} variant="outline" size="sm" onClick={() => setMoveType(t)}><Plus /> {MOVEMENT_LABEL[t]}</Button>)}</Can>
            <Can permission="shifts.close"><Button className="ml-auto" onClick={() => { setCounted(""); setClosing(true); }}>Close shift</Button></Can>
          </div>
          {shift.movements.length > 0 && (
            <ul className="divide-y rounded-lg border text-sm">{shift.movements.map((mv) => <li key={mv.id} className="flex justify-between px-3 py-2"><span>{MOVEMENT_LABEL[mv.type]}{mv.note ? ` · ${mv.note}` : ""}<span className="ml-2 text-xs text-muted-foreground">{format(new Date(mv.occurredAt), "HH:mm")}</span></span><span className="tabular-nums">{mv.type === "CASH_IN" ? "+" : "-"}{m(mv.amountMinor)}</span></li>)}</ul>
          )}
        </section>
      )}

      <section aria-label="Previous shifts" className="mb-8">
        <h2 className="mb-2 font-semibold">Previous shifts</h2>
        {history.isPending ? <LoadingRows rows={3} /> : (history.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No closed shifts yet.</p> : (
          <div className="overflow-hidden rounded-xl border bg-card"><Table>
            <TableHeader><TableRow><TableHead>Day</TableHead><TableHead>Till</TableHead><TableHead>Cashier</TableHead><TableHead className="text-right">Expected</TableHead><TableHead className="text-right">Counted</TableHead><TableHead className="text-right">Difference</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
            <TableBody>{(history.data ?? []).map((s) => (
              <TableRow key={s.id}><TableCell>{s.businessDate}</TableCell><TableCell>{s.registerName}</TableCell><TableCell>{s.openedByName}</TableCell>
                <TableCell className="text-right tabular-nums">{m(s.expectedCashMinor)}</TableCell><TableCell className="text-right tabular-nums">{m(s.countedCashMinor)}</TableCell>
                <TableCell className={`text-right tabular-nums ${varianceTone(s.varianceMinor)}`}>{varianceText(s.varianceMinor, fmt)}</TableCell>
                <TableCell className="text-right">{s.zReportId && <Can permission="zreport.view"><Button size="sm" variant="ghost" onClick={() => setZId(s.zReportId)}><FileText /> Z</Button></Can>}</TableCell></TableRow>
            ))}</TableBody></Table></div>
        )}
      </section>

      <Can permission="zreport.view">
        <section aria-label="End of day report" className="rounded-xl border bg-card p-4">
          <h2 className="font-semibold">End-of-day report</h2>
          <p className="mb-3 text-sm text-muted-foreground">Totals for a whole trading day at this branch, across all shifts.</p>
          <div className="flex flex-wrap items-end gap-3"><div className="space-y-1.5"><Label htmlFor="day">Trading day</Label><Input id="day" type="date" className="w-44" value={dayDate} onChange={(e) => setDayDate(e.target.value)} /></div><Button variant="outline" disabled={day.isPending || !dayDate} onClick={() => day.mutate()}><FileText /> {day.isPending ? "Preparing…" : "Show Z-report"}</Button></div>
        </section>
      </Can>

      <Dialog open={!!moveType} onOpenChange={(o) => !o && setMoveType(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{moveType ? MOVEMENT_LABEL[moveType] : ""}</DialogTitle><DialogDescription>{moveType === "CASH_IN" ? "Money added to the drawer." : "Money taken out of the drawer. It cannot be more than the drawer holds."}</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="mv-amount">Amount ({fmt.symbol})</Label><Input id="mv-amount" inputMode="decimal" autoFocus className="h-11 text-lg" value={moveAmount} onChange={(e) => setMoveAmount(e.target.value)} /></div>
          {needsReason && <div className="space-y-1.5"><Label>Reason</Label><div className="flex flex-wrap gap-2">{(ctx.data?.reasons.cashOut ?? []).map((r) => <button key={r.id} type="button" aria-pressed={r.id === moveReason} onClick={() => setMoveReason(r.id)} className={`rounded-lg border px-3 py-1.5 text-sm ${r.id === moveReason ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>{r.name}</button>)}</div></div>}
          <Input placeholder="Note (optional)" value={moveNote} onChange={(e) => setMoveNote(e.target.value)} />
          <DialogFooter><Button variant="outline" onClick={() => setMoveType(null)}>Cancel</Button><Button disabled={move.isPending || toMinor(moveAmount, fmt.exponent) === null || (needsReason && !moveReason)} onClick={() => shift && move.mutate(shift.id)}>{move.isPending ? "Saving…" : "Record"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent>
          <DialogHeader><DialogTitle>Close shift</DialogTitle><DialogDescription>{shift?.isBlindClose ? "Count every note and coin in the drawer and enter the total. The expected amount stays hidden until you close." : `Count the drawer. The system expects ${m(shift?.figures.expectedCashMinor)}.`}</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="counted">Cash counted ({fmt.symbol})</Label><Input id="counted" inputMode="decimal" autoFocus className="h-12 text-xl" value={counted} onChange={(e) => setCounted(e.target.value)} />
            {!shift?.isBlindClose && toMinor(counted, fmt.exponent) !== null && shift?.figures.expectedCashMinor != null && <p className={`text-sm ${varianceTone(toMinor(counted, fmt.exponent)! - shift.figures.expectedCashMinor)}`}>{varianceText(toMinor(counted, fmt.exponent)! - shift.figures.expectedCashMinor, fmt)}</p>}</div>
          <Input placeholder="Note (optional)" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
          <DialogFooter><Button variant="outline" onClick={() => setClosing(false)}>Cancel</Button><Button disabled={close.isPending || toMinor(counted, fmt.exponent) === null} onClick={() => shift && close.mutate(shift.id)}>{close.isPending ? "Closing…" : "Close shift"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {zId && <ZReportDialog id={zId} onClose={() => setZId(null)} />}
    </>
  );
}
