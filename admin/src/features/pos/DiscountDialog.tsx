import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { toMinor } from "@/lib/money";
import { discountPercent, money, type DiscountDraft, type MoneyFormat } from "./cart";
import type { PosReason } from "./types";

interface Promo { id: string; name: string; description: string | null; valueType: "PERCENT" | "AMOUNT"; value: number; minSubtotalMinor: number; eligible: boolean }

/** Coupons and running promotions (the server decides what they are worth) and, for people who may, a manual percent or amount with a reason. */
export function DiscountDialog({ locationId, canManual, reasons, subtotalMinor, fmt, current, onApply, onClear, onClose }: {
  locationId: string; canManual: boolean; reasons: PosReason[]; subtotalMinor: number; fmt: MoneyFormat; current: DiscountDraft | null; onApply: (d: DiscountDraft) => void; onClear: () => void; onClose: () => void;
}) {
  const [mode, setMode] = useState<"offer" | "manual">(canManual && current && !current.offer ? "manual" : "offer");
  const [type, setType] = useState<"PERCENT" | "AMOUNT">(current && !current.offer ? current.type : "PERCENT");
  const [value, setValue] = useState(current && !current.offer ? String(current.type === "PERCENT" ? current.value : current.value / 10 ** fmt.exponent) : "");
  const [reasonId, setReasonId] = useState(current?.reasonId ?? "");
  const [note, setNote] = useState(current?.note ?? "");
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState("");
  const [checking, setChecking] = useState(false);
  const reason = reasons.find((r) => r.id === reasonId);
  const promos = useQuery({ queryKey: ["/offers/promotions", locationId, subtotalMinor], queryFn: async () => (await api.get<{ data: Promo[] }>("/offers/promotions", { locationId, subtotalMinor })).data });

  const amountMinor = type === "AMOUNT" ? toMinor(value, fmt.exponent) : null;
  const percent = type === "PERCENT" ? Number(value) : null;
  const valid = type === "PERCENT" ? percent !== null && percent > 0 && percent <= 100 : amountMinor !== null && amountMinor > 0;
  const problem = !valid ? "Enter a discount" : !reasonId ? "Choose a reason" : reason?.requiresNote && !note.trim() ? "This reason needs a note" : null;
  const describe = (t: "PERCENT" | "AMOUNT", v: number) => (t === "PERCENT" ? `${v}% off` : `${money(v, fmt)} off`);

  const checkCoupon = async () => {
    setChecking(true);
    setCodeMsg("");
    try {
      const r = (await api.post<{ data: { valid: boolean; message?: string; code?: string; valueType?: "PERCENT" | "AMOUNT"; value?: number } }>("/offers/coupon-check", { code, locationId, subtotalMinor })).data;
      if (!r.valid) setCodeMsg(r.message ?? "That coupon is not valid");
      else onApply({ type: r.valueType!, value: r.value!, reasonId: "", note: "", offer: { couponCode: r.code! }, label: `Coupon ${r.code}` });
    } catch (e) {
      setCodeMsg(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Discount</DialogTitle><DialogDescription>Comes off before tax.{canManual ? " A manual discount above your limit needs a manager." : ""}</DialogDescription></DialogHeader>
        {canManual && (
          <div className="inline-flex rounded-lg border p-0.5" role="tablist" aria-label="Kind of discount">
            {([["offer", "Coupon or offer"], ["manual", "Manual"]] as const).map(([m, label]) => <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`flex-1 rounded-md px-4 py-2 text-sm ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{label}</button>)}
          </div>
        )}
        {mode === "offer" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="coupon-code">Coupon code</Label>
              <div className="flex gap-2">
                <Input id="coupon-code" autoFocus value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeMsg(""); }} onKeyDown={(e) => e.key === "Enter" && code && void checkCoupon()} className="h-11 uppercase" placeholder="SAVE10" />
                <Button className="h-11" disabled={!code.trim() || checking} onClick={() => void checkCoupon()}>Apply</Button>
              </div>
              {codeMsg && <p className="text-sm text-destructive">{codeMsg}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Running now</Label>
              {(promos.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No promotions are running at this branch right now.</p> : (
                <div className="space-y-2">
                  {promos.data!.map((p) => (
                    <button key={p.id} type="button" disabled={!p.eligible} onClick={() => onApply({ type: p.valueType, value: p.value, reasonId: "", note: "", offer: { promotionId: p.id }, label: p.name })} className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left hover:bg-accent disabled:opacity-50">
                      <span><span className="font-medium">{p.name}</span>{!p.eligible && <span className="block text-xs text-muted-foreground">Needs a bigger order</span>}{p.description && p.eligible && <span className="block text-xs text-muted-foreground">{p.description}</span>}</span>
                      <span className="text-sm font-semibold text-primary">{describe(p.valueType, p.value)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter className="sm:justify-between">{current ? <Button variant="ghost" onClick={onClear}>Remove discount</Button> : <span />}<Button variant="outline" onClick={onClose}>Cancel</Button></DialogFooter>
          </>
        ) : (
          <>
            <div className="inline-flex rounded-lg border p-0.5" role="radiogroup" aria-label="Discount type">
              {(["PERCENT", "AMOUNT"] as const).map((t) => <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={`flex-1 rounded-md px-4 py-2 text-sm ${type === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{t === "PERCENT" ? "Percent %" : "Amount"}</button>)}
            </div>
            <div className="space-y-1.5"><Label htmlFor="disc-value">{type === "PERCENT" ? "Percent" : "Amount"}</Label><Input id="disc-value" inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="h-12 text-xl" /></div>
            {type === "PERCENT" && <div className="flex gap-2">{[5, 10, 15, 20].map((p) => <Button key={p} type="button" variant="outline" size="sm" onClick={() => setValue(String(p))}>{p}%</Button>)}</div>}
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <div className="flex flex-wrap gap-2">{reasons.map((r) => <button key={r.id} type="button" aria-pressed={r.id === reasonId} onClick={() => setReasonId(r.id)} className={`rounded-lg border px-3 py-1.5 text-sm ${r.id === reasonId ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>{r.name}</button>)}</div>
            </div>
            {reason?.requiresNote && <div className="space-y-1.5"><Label htmlFor="disc-note">Note</Label><Input id="disc-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></div>}
            <DialogFooter className="sm:justify-between">
              {current ? <Button variant="ghost" onClick={onClear}>Remove discount</Button> : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button disabled={!!problem} onClick={() => onApply({ type, value: type === "PERCENT" ? percent! : amountMinor!, reasonId, note })}>Apply{valid ? ` ${type === "PERCENT" ? `${percent}%` : ""}` : ""}</Button>
              </div>
            </DialogFooter>
            {valid && type === "AMOUNT" && subtotalMinor > 0 && <p className="text-xs text-muted-foreground">That is {discountPercent({ type, value: amountMinor!, reasonId, note }, subtotalMinor).toFixed(1)}% of the order.</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
