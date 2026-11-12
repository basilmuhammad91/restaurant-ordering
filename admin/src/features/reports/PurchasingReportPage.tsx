import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fmtDate } from "@/components/cells";
import { Bars, Tile } from "@/components/page/charts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtQty } from "@/features/inventory/shared";
import { SimpleSelect } from "@/features/menu/shared";
import { PoBadge, useSuppliers } from "@/features/purchasing/shared";
import { api } from "@/lib/api";
import { useScope } from "@/lib/scope";
import { ExportButton, ReportPage, useReport, useReportCurrency, useReportMoney } from "./shared";

interface Purchasing {
  currencyCode: string; spendMinor: number; paidMinor: number; outstandingMinor: number; aging: { current: number; d1_30: number; d31_60: number; d60plus: number };
  bySupplier: { supplierId: string; name: string; receipts: number; spendMinor: number }[]; topItems: { itemId: string; name: string; unit: string; qty: number; spendMinor: number; avgCostMinor: number }[];
  ordersByStatus: Record<string, { orders: number; totalMinor: number }>;
}
interface Ledger { supplier: { name: string }; openingMinor: number; closingMinor: number; entries: { date: string; type: "invoice" | "payment"; ref: string; debitMinor: number; creditMinor: number; balanceMinor: number }[] }

/** What you bought and from whom, what you owe and how overdue it is, and any supplier's full account. */
export default function PurchasingReportPage() {
  const currency = useReportCurrency();
  const q = useReport<Purchasing>("/reports/purchasing", currency.code);
  const { money, exp } = useReportMoney(currency.code);
  const { range } = useScope();
  const suppliers = useSuppliers();
  const [supplierId, setSupplierId] = useState("");
  const ledger = useQuery({ queryKey: ["/reports/supplier-ledger", supplierId, range.from, range.to], enabled: !!supplierId, queryFn: async () => (await api.get<{ data: Ledger }>("/reports/supplier-ledger", { supplierId, from: range.from, to: range.to })).data });
  const p = q.data?.data;
  const AGE = p ? [["Not yet due", p.aging.current], ["1-30 days late", p.aging.d1_30], ["31-60 days late", p.aging.d31_60], ["Over 60 days late", p.aging.d60plus]] as const : [];

  return (
    <ReportPage title="Purchasing" description="Spend, supplier balances and ageing." currency={currency} state={q}
      actions={p && <ExportButton name="purchasing-by-supplier" header={["Supplier", "Receipts", "Spend"]} rows={p.bySupplier.map((s) => [s.name, s.receipts, s.spendMinor / 10 ** exp])} />}>
      {p && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile label="Bought in period" value={money(p.spendMinor)} hint="goods received" />
            <Tile label="Paid in period" value={money(p.paidMinor)} hint="to suppliers" />
            <Tile label="You owe now" value={money(p.outstandingMinor)} hint="all unpaid invoices" tone={p.aging.d1_30 + p.aging.d31_60 + p.aging.d60plus > 0 ? "bad" : undefined} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">Spend by supplier</CardTitle></CardHeader><CardContent><Bars rows={p.bySupplier.map((s) => ({ label: s.name, value: s.spendMinor, sub: `${s.receipts} deliveries` }))} format={money} /></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">What you owe, by age</CardTitle><CardDescription>Unpaid invoices by how late they are.</CardDescription></CardHeader><CardContent><Bars rows={AGE.map(([label, value]) => ({ label, value }))} format={money} /></CardContent></Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">Biggest purchases</CardTitle></CardHeader><CardContent>
              {p.topItems.length === 0 ? <p className="text-sm text-muted-foreground">Nothing received in this period.</p> : (
                <Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Bought</TableHead><TableHead className="text-right">Avg cost</TableHead><TableHead className="text-right">Spend</TableHead></TableRow></TableHeader>
                  <TableBody>{p.topItems.map((i) => <TableRow key={i.itemId}><TableCell className="font-medium">{i.name}</TableCell><TableCell className="text-right tabular-nums">{fmtQty(i.qty)} {i.unit}</TableCell><TableCell className="text-right tabular-nums">{money(i.avgCostMinor)}/{i.unit}</TableCell><TableCell className="text-right tabular-nums">{money(i.spendMinor)}</TableCell></TableRow>)}</TableBody></Table>
              )}
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Purchase orders raised</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
              {Object.keys(p.ordersByStatus).length === 0 ? <p className="text-muted-foreground">None in this period.</p> : Object.entries(p.ordersByStatus).map(([s, v]) => <div key={s} className="flex items-center justify-between"><PoBadge status={s} /><span className="tabular-nums">{v.orders} · {money(v.totalMinor)}</span></div>)}
            </CardContent></Card>
          </div>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">Supplier ledger</CardTitle><CardDescription>Invoices and payments for one supplier, with the balance after each.</CardDescription></div>
              <div className="w-56"><SimpleSelect value={supplierId} onChange={setSupplierId} label="Supplier" options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))} placeholder="Choose a supplier" /></div></CardHeader>
            <CardContent>
              {!supplierId ? <p className="text-sm text-muted-foreground">Choose a supplier to see their account.</p> : !ledger.data ? <p className="text-sm text-muted-foreground">Loading…</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Entry</TableHead><TableHead className="text-right">Invoiced</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
                  <TableBody>
                    <TableRow><TableCell colSpan={4} className="text-muted-foreground">Owed at the start of the period</TableCell><TableCell className="text-right tabular-nums">{money(ledger.data.openingMinor)}</TableCell></TableRow>
                    {ledger.data.entries.map((e, i) => <TableRow key={i}><TableCell className="text-muted-foreground">{fmtDate(e.date)}</TableCell><TableCell><Badge variant="secondary" className="mr-2">{e.type === "invoice" ? "Invoice" : "Payment"}</Badge>{e.ref}</TableCell><TableCell className="text-right tabular-nums">{e.debitMinor ? money(e.debitMinor) : ""}</TableCell><TableCell className="text-right tabular-nums">{e.creditMinor ? money(e.creditMinor) : ""}</TableCell><TableCell className="text-right tabular-nums">{money(e.balanceMinor)}</TableCell></TableRow>)}
                    <TableRow><TableCell colSpan={4} className="font-semibold">Owed at the end of the period</TableCell><TableCell className="text-right font-semibold tabular-nums">{money(ledger.data.closingMinor)}</TableCell></TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </ReportPage>
  );
}
