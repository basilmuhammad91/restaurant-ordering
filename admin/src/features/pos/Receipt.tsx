import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { money, type MoneyFormat } from "./cart";
import type { PosOrder } from "./types";

/** Tax per authority, summed over every line, as printed at the bottom of a receipt. */
export function taxByAuthority(order: PosOrder): { authorityCode: string; name: string; baseMinor: number; taxMinor: number; rateBp: number }[] {
  const map = new Map<string, { authorityCode: string; name: string; baseMinor: number; taxMinor: number; rateBp: number }>();
  for (const l of order.lines) {
    if (l.status === "VOIDED") continue;
    for (const t of l.taxes) {
      const key = `${t.authorityCode}:${t.rateBp}`;
      const cur = map.get(key) ?? { authorityCode: t.authorityCode, name: t.ruleNameSnapshot, baseMinor: 0, taxMinor: 0, rateBp: t.rateBp };
      cur.baseMinor += t.baseMinor;
      cur.taxMinor += t.taxMinor;
      map.set(key, cur);
    }
  }
  return [...map.values()];
}

/** An 80 mm receipt. The printed page shows only this block (see the @media print rules in index.css). */
export function ReceiptBody({ order, fmt }: { order: PosOrder; fmt: MoneyFormat }) {
  const m = (n: number) => money(n, fmt);
  // the organization-wide receipt template (Settings > Receipt template); a branch's own header and footer win over it
  const tpl = useQuery({ queryKey: ["/settings", "receipt"], staleTime: 300_000, queryFn: async () => (await api.get<{ data: { headerText: string | null; footerText: string | null; showTaxBreakdown: boolean; showCustomer: boolean } }>("/settings/receipt")).data }).data;
  const header = order.location.receiptHeader ?? tpl?.headerText ?? null;
  const footer = order.location.receiptFooter ?? tpl?.footerText ?? null;
  const showTax = tpl?.showTaxBreakdown ?? true;
  const lines = order.lines.filter((l) => l.status !== "VOIDED");
  const taxes = showTax ? taxByAuthority(order) : [];
  const change = order.payments.reduce((a, p) => a + p.changeMinor, 0);
  const rule = <div className="my-1.5 border-t border-dashed border-black/60" />;
  return (
    <div id="receipt-print" className="mx-auto w-[300px] bg-white p-3 font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        <div className="text-sm font-bold">{order.location.name}</div>
        {order.location.address && <div>{order.location.address}{order.location.city ? `, ${order.location.city}` : ""}</div>}
        {order.location.phone && <div>{order.location.phone}</div>}
        {header && <div className="mt-1 whitespace-pre-line">{header}</div>}
      </div>
      {rule}
      <div className="flex justify-between"><span>Order {order.orderNumber}</span><span>{order.orderType.replace("_", " ").toLowerCase()}</span></div>
      <div>{format(new Date(order.occurredAt), "dd MMM yyyy HH:mm")}</div>
      {order.customerName && (tpl?.showCustomer ?? true) && <div>Customer: {order.customerName}</div>}
      {rule}
      {lines.map((l) => (
        <div key={l.id} className="mb-1">
          <div className="flex justify-between gap-2"><span>{l.quantity} × {l.nameSnapshot}{l.variantNameSnapshot ? ` (${l.variantNameSnapshot})` : ""}</span><span>{m(l.lineSubtotalMinor)}</span></div>
          {l.modifiers.map((x) => <div key={x.id} className="pl-3 text-[11px]">+ {x.nameSnapshot}{x.priceMinor > 0 ? ` ${m(x.priceMinor)}` : ""}</div>)}
          {l.children.filter((c) => c.status !== "VOIDED").map((c) => <div key={c.id} className="pl-3 text-[11px]">· {c.quantity} × {c.nameSnapshot}{c.variantNameSnapshot ? ` (${c.variantNameSnapshot})` : ""}</div>)}
          {l.notes && <div className="pl-3 text-[11px] italic">“{l.notes}”</div>}
        </div>
      ))}
      {rule}
      <div className="flex justify-between"><span>Subtotal</span><span>{m(order.subtotalMinor)}</span></div>
      {order.discountMinor > 0 && <div className="flex justify-between"><span>Discount</span><span>-{m(order.discountMinor)}</span></div>}
      {order.deliveryFeeMinor > 0 && <div className="flex justify-between"><span>Delivery</span><span>{m(order.deliveryFeeMinor)}</span></div>}
      {!order.pricesIncludeTax && taxes.map((t) => <div key={`${t.authorityCode}${t.rateBp}`} className="flex justify-between"><span>{t.name} {t.rateBp / 100}%</span><span>{m(t.taxMinor)}</span></div>)}
      <div className="mt-1 flex justify-between text-sm font-bold"><span>TOTAL</span><span>{m(order.totalMinor)}</span></div>
      {order.pricesIncludeTax && taxes.length > 0 && <div className="mt-1 text-[11px]">Includes {taxes.map((t) => `${t.name} ${t.rateBp / 100}% ${m(t.taxMinor)}`).join(", ")}</div>}
      {rule}
      {order.payments.map((p) => <div key={p.id} className="flex justify-between"><span>{p.paymentMethod.name}{p.reference ? ` (${p.reference})` : ""}</span><span>{m(p.tenderedMinor)}</span></div>)}
      {change > 0 && <div className="flex justify-between"><span>Change</span><span>{m(change)}</span></div>}
      {order.tipMinor > 0 && <div className="flex justify-between"><span>Tip</span><span>{m(order.tipMinor)}</span></div>}
      {order.refundedMinor > 0 && <div className="flex justify-between"><span>Refunded</span><span>-{m(order.refundedMinor)}</span></div>}
      {order.totalMinor - order.paidMinor > 0 && <div className="flex justify-between font-bold"><span>DUE</span><span>{m(order.totalMinor - order.paidMinor)}</span></div>}
      {footer && <><div className="my-1.5 border-t border-dashed border-black/60" /><div className="text-center whitespace-pre-line">{footer}</div></>}
    </div>
  );
}

export function ReceiptDialog({ order, fmt, title = "Receipt", onClose }: { order: PosOrder; fmt: MoneyFormat; title?: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Order {order.orderNumber}</DialogDescription></DialogHeader>
        <div className="overflow-hidden rounded-lg border bg-white"><ReceiptBody order={order} fmt={fmt} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => window.print()}><Printer /> Print</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
