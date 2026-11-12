import { Bars, Tile } from "@/components/page/charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtQty, MOVE_LABEL } from "@/features/inventory/shared";
import { ExportButton, ReportPage, useReport, useReportCurrency, useReportMoney } from "./shared";

interface InvReport {
  currencyCode: string; totalValueMinor: number; lowCount: number; outCount: number;
  byLocation: { locationId: string; name: string; valueMinor: number; items: number }[]; byCategory: { category: string; valueMinor: number }[];
  movement: { type: string; count: number; valueMinor: number }[]; topUsage: { itemId: string; name: string; unit: string; qty: number; valueMinor: number }[];
}

/** What your stock is worth and where, what moved during the period, and what you use most. */
export default function InventoryReportPage() {
  const currency = useReportCurrency();
  const q = useReport<InvReport>("/reports/inventory", currency.code);
  const { money, exp } = useReportMoney(currency.code);
  const r = q.data?.data;
  return (
    <ReportPage title="Inventory" description="Stock value today, and movement during the period." currency={currency} state={q}
      actions={r && <ExportButton name="inventory-valuation" header={["Location", "Value", "Items in stock"]} rows={r.byLocation.map((l) => [l.name, l.valueMinor / 10 ** exp, l.items])} />}>
      {r && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile label="Stock value" value={money(r.totalValueMinor)} hint="at average cost, today" />
            <Tile label="Running low" value={String(r.lowCount)} tone={r.lowCount ? "bad" : undefined} />
            <Tile label="Out of stock" value={String(r.outCount)} tone={r.outCount ? "bad" : undefined} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">By location</CardTitle></CardHeader><CardContent><Bars rows={r.byLocation.map((l) => ({ label: l.name, value: l.valueMinor, sub: `${l.items} items` }))} format={money} /></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">By category</CardTitle></CardHeader><CardContent><Bars rows={r.byCategory.map((c) => ({ label: c.category, value: c.valueMinor }))} format={money} /></CardContent></Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">Stock movement</CardTitle><CardDescription>Everything posted to the ledger in this period. Negative is stock leaving.</CardDescription></CardHeader><CardContent>
              {r.movement.length === 0 ? <p className="text-sm text-muted-foreground">No movement in this period.</p> : (
                <Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead className="text-right">Entries</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
                  <TableBody>{r.movement.map((m) => <TableRow key={m.type}><TableCell>{MOVE_LABEL[m.type] ?? m.type}</TableCell><TableCell className="text-right tabular-nums">{m.count}</TableCell><TableCell className={`text-right tabular-nums ${m.valueMinor < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{money(m.valueMinor)}</TableCell></TableRow>)}</TableBody></Table>
              )}
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Most used in sales</CardTitle><CardDescription>Ingredients taken out by completed orders.</CardDescription></CardHeader><CardContent>
              {r.topUsage.length === 0 ? <p className="text-sm text-muted-foreground">No ingredient usage yet. It appears once recipes exist and orders are completed.</p> : (
                <Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Used</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
                  <TableBody>{r.topUsage.map((u) => <TableRow key={u.itemId}><TableCell className="font-medium">{u.name}</TableCell><TableCell className="text-right tabular-nums">{fmtQty(u.qty)} {u.unit}</TableCell><TableCell className="text-right tabular-nums">{money(u.valueMinor)}</TableCell></TableRow>)}</TableBody></Table>
              )}
            </CardContent></Card>
          </div>
        </div>
      )}
    </ReportPage>
  );
}
