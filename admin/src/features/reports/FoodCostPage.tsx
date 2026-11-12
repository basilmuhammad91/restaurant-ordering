import { AlertTriangle } from "lucide-react";
import { Bars, DayChart, Tile } from "@/components/page/charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtQty } from "@/features/inventory/shared";
import { ExportButton, ReportPage, useReport, useReportCurrency, useReportMoney } from "./shared";

interface FoodCost {
  currencyCode: string; salesMinor: number; soldQty: number; recipeCoveragePct: number; theoreticalCostMinor: number; theoreticalPct: number | null; wasteMinor: number; wasteByType: { type: string; valueMinor: number }[];
  shrinkMinor: number; actualCostMinor: number; actualPct: number | null; grossProfitMinor: number; purchasesMinor: number;
  topWasted: { name: string; unit: string; qty: number; valueMinor: number }[]; byDay: { date: string; salesMinor: number; costMinor: number; pct: number | null }[];
}
const LOSS = { WASTE: "Waste", EXPIRED: "Expired", DAMAGE: "Damaged", STAFF_MEAL: "Staff meals" } as Record<string, string>;
const pct = (n: number | null) => (n === null ? "-" : `${n}%`);

/** Food cost: what the dishes sold should have cost from their recipes, plus waste and stock that went missing, against sales. */
export default function FoodCostPage() {
  const currency = useReportCurrency();
  const q = useReport<FoodCost>("/reports/food-cost", currency.code);
  const { money, exp } = useReportMoney(currency.code);
  const f = q.data?.data;
  return (
    <ReportPage title="Food cost" description="Theoretical cost comes from recipes; actual adds waste and counted losses." currency={currency} state={q}
      actions={f && <ExportButton name="food-cost" header={["Date", "Sales", "Cost", "Cost %"]} rows={f.byDay.map((d) => [d.date, d.salesMinor / 10 ** exp, d.costMinor / 10 ** exp, d.pct])} />}>
      {f && (
        <div className="space-y-4">
          {f.recipeCoveragePct < 100 && f.soldQty > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /><span>Only {f.recipeCoveragePct}% of what was sold has a recipe, so the cost below is understated. Add recipes under Inventory &gt; Recipes.</span></div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Net sales" value={money(f.salesMinor)} hint={`${f.soldQty} items sold`} />
            <Tile label="Theoretical food cost" value={pct(f.theoreticalPct)} hint={money(f.theoreticalCostMinor)} />
            <Tile label="Actual food cost" value={pct(f.actualPct)} hint={`${money(f.actualCostMinor)} with waste and losses`} tone={f.actualPct !== null && f.theoreticalPct !== null && f.actualPct - f.theoreticalPct > 2 ? "bad" : undefined} />
            <Tile label="Gross profit" value={money(f.grossProfitMinor)} hint="net sales minus actual cost" tone="good" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2"><CardHeader><CardTitle className="text-base">Ingredient cost per day</CardTitle><CardDescription>Cost of what was sold, from recipes.</CardDescription></CardHeader><CardContent><DayChart days={f.byDay.map((d) => ({ date: d.date, totalMinor: d.costMinor }))} format={money} /></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Where the extra cost came from</CardTitle></CardHeader><CardContent className="space-y-3">
              <Bars rows={[...f.wasteByType.filter((w) => w.valueMinor > 0).map((w) => ({ label: LOSS[w.type] ?? w.type, value: w.valueMinor })), ...(f.shrinkMinor > 0 ? [{ label: "Stock missing at counts", value: f.shrinkMinor }] : [])]} format={money} />
              <p className="text-xs text-muted-foreground">Stock bought in the period: {money(f.purchasesMinor)}.</p>
            </CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle className="text-base">Most wasted items</CardTitle></CardHeader><CardContent>
            {f.topWasted.length === 0 ? <p className="text-sm text-muted-foreground">No waste recorded in this period.</p> : (
              <Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
                <TableBody>{f.topWasted.map((w) => <TableRow key={w.name}><TableCell className="font-medium">{w.name}</TableCell><TableCell className="text-right tabular-nums">{fmtQty(w.qty)} {w.unit}</TableCell><TableCell className="text-right tabular-nums">{money(w.valueMinor)}</TableCell></TableRow>)}</TableBody></Table>
            )}
          </CardContent></Card>
        </div>
      )}
    </ReportPage>
  );
}
