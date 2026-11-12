import { Banknote, CreditCard, Landmark, QrCode, Smartphone, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api, errorMessage } from "@/lib/api";
import { fromMinor, toMinor } from "@/lib/money";
import { money, quickAmounts, type MoneyFormat } from "./cart";
import type { PosMethod, PosOrder } from "./types";

const ICONS: Record<string, typeof Banknote> = { CASH: Banknote, CARD: CreditCard, WALLET: Smartphone, QR: QrCode, BANK_TRANSFER: Landmark, OTHER: Wallet };

/**
 * Take payment: pick a method, type what the customer hands over, add a tip. Cash over the bill gives change.
 * Several payments can settle one bill (split between cash and card). A payment id made here makes a retry safe:
 * if the network drops after the money was recorded, sending it again does not charge twice.
 */
export function PaymentDialog({ order, methods, fmt, onUpdated, onDone, onClose }: {
  order: PosOrder; methods: PosMethod[]; fmt: MoneyFormat; onUpdated: (o: PosOrder) => void; onDone: (o: PosOrder, changeMinor: number) => void; onClose: () => void;
}) {
  const [current, setCurrent] = useState(order);
  const due = Math.max(current.totalMinor - current.paidMinor, 0);
  const [methodId, setMethodId] = useState(methods.find((m) => m.type === "CASH")?.id ?? methods[0]?.id ?? "");
  const method = methods.find((m) => m.id === methodId);
  const [tendered, setTendered] = useState(fromMinor(due, fmt.exponent));
  const [tip, setTip] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [attemptId, setAttemptId] = useState(() => crypto.randomUUID());

  const tenderedMinor = toMinor(tendered, fmt.exponent);
  const tipMinor = tip.trim() ? toMinor(tip, fmt.exponent) : 0;
  const isCash = method?.type === "CASH";
  const change = isCash && tenderedMinor !== null && tenderedMinor > due ? tenderedMinor - due : 0;
  const quick = useMemo(() => (isCash ? quickAmounts(due, fmt.exponent) : [due]), [isCash, due, fmt.exponent]);

  const problem =
    !method ? "Choose a payment method"
    : tenderedMinor === null || tenderedMinor <= 0 ? "Enter the amount"
    : !isCash && tenderedMinor > due ? "This method cannot be more than the amount due"
    : tipMinor === null ? "Enter a valid tip"
    : method.requiresReference && !reference.trim() ? `Enter the ${method.name.toLowerCase()} reference`
    : null;

  const pay = async () => {
    if (problem || !method || tenderedMinor === null) return;
    setBusy(true);
    try {
      const res = await api.post<{ data: PosOrder; meta: { changeMinor?: number } }>(`/orders/${current.id}/payments`, {
        id: attemptId, paymentMethodId: method.id, tenderedMinor, ...(tipMinor ? { tipMinor } : {}), ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      const updated = res.data;
      setCurrent(updated);
      onUpdated(updated);
      setAttemptId(crypto.randomUUID()); // the next payment is a new one
      setTip("");
      setReference("");
      const left = Math.max(updated.totalMinor - updated.paidMinor, 0);
      if (left === 0) onDone(updated, res.meta?.changeMinor ?? 0);
      else {
        setTendered(fromMinor(left, fmt.exponent));
        toast.success(`${money(res.data.paidMinor, fmt)} paid, ${money(left, fmt)} still due`);
      }
    } catch (e) {
      // a dropped connection keeps the same attempt id, so pressing Pay again cannot charge twice
      toast.error(e instanceof ApiError && e.status === 0 ? "No connection. Press Pay again: it will not charge twice." : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Payment · {current.orderNumber}</DialogTitle>
          <DialogDescription>Total {money(current.totalMinor, fmt)}{current.paidMinor > 0 && <> · paid {money(current.paidMinor, fmt)}</>}</DialogDescription>
        </DialogHeader>

        <div className="rounded-xl bg-muted/50 p-4 text-center">
          <div className="text-sm text-muted-foreground">Amount due</div>
          <div className="text-4xl font-bold tabular-nums" aria-live="polite">{money(due, fmt)}</div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Payment method">
          {methods.map((m) => {
            const Icon = ICONS[m.type] ?? Wallet;
            return (
              <button key={m.id} type="button" role="radio" aria-checked={m.id === methodId} onClick={() => { setMethodId(m.id); if (m.type !== "CASH") setTendered(fromMinor(due, fmt.exponent)); }}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm transition-colors ${m.id === methodId ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent"}`}>
                <Icon className="size-4" /> {m.name}
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tendered">{isCash ? "Cash received" : "Amount"}</Label>
            <Input id="tendered" inputMode="decimal" className="h-12 text-xl tabular-nums" value={tendered} onChange={(e) => setTendered(e.target.value)} autoFocus />
            <div className="flex flex-wrap gap-2">
              {quick.map((q) => <Button key={q} type="button" size="sm" variant="outline" onClick={() => setTendered(fromMinor(q, fmt.exponent))}>{q === due ? "Exact" : money(q, fmt)}</Button>)}
            </div>
          </div>
          {change > 0 && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-center"><span className="text-sm text-muted-foreground">Change to give </span><span className="text-2xl font-bold tabular-nums">{money(change, fmt)}</span></div>}
          {method?.requiresReference && <div className="space-y-1.5"><Label htmlFor="ref">{method.name} reference</Label><Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Slip or transaction number" /></div>}
          <div className="space-y-1.5"><Label htmlFor="tip">Tip (optional)</Label><Input id="tip" inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} placeholder="0" /></div>
        </div>

        {problem && tendered !== "" && <p className="text-sm text-destructive" role="alert">{problem}</p>}
        <Button size="lg" className="h-12 text-base" disabled={busy || !!problem} onClick={() => void pay()}>
          {busy ? "Recording…" : tenderedMinor !== null && tenderedMinor < due ? `Take ${money(tenderedMinor, fmt)} (split)` : `Take payment ${money(Math.min(tenderedMinor ?? due, due), fmt)}`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
