import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportButton, ReportPage, useReport, useReportCurrency, useReportMoney } from "./shared";

interface Row { key: string; name: string; kind: "item" | "combo"; qty: number; revenueMinor: number; avgPriceMinor: number; unitCostMinor: number | null; marginMinor: number | null; marginPerUnitMinor: number | null; costPct: number | null; group: "STAR" | "PLOWHORSE" | "PUZZLE" | "DOG" | null }

const GROUPS = {
  STAR: { label: "Stars", help: "Popular and profitable. Protect them: keep quality high and put them first.", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  PLOWHORSE: { label: "Plowhorses", help: "Popular but thin margin. Try a small price rise or a cheaper recipe.", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  PUZZLE: { label: "Puzzles", help: "Profitable but slow sellers. Promote them, rename them or move them up the menu.", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  DOG: { label: "Dogs", help: "Neither popular nor profitable. Consider dropping or reworking them.", tone: "bg-red-500/15 text-red-700 dark:text-red-400" },
} as const;

/** Each dish placed by how often it sells and how much it earns per sale. Needs recipes to know the cost. */
export default function MenuEngineeringPage() {
  const currency = useReportCurrency();
  const q = useReport<Row[]>("/reports/menu-performance", currency.code);
  const { money, exp } = useReportMoney(currency.code);
  const [group, setGroup] = useState<keyof typeof GROUPS | "ALL" | "NONE">("ALL");
  const rows = q.data?.data ?? [];
  const counts = (g: string) => rows.filter((r) => r.group === g).length;
  const shown = rows.filter((r) => (group === "ALL" ? true : group === "NONE" ? r.group === null : r.group === group));

  return (
    <ReportPage title="Menu engineering" description="Which dishes earn their place on the menu." currency={currency} state={q}
      actions={<ExportButton name="menu-engineering" header={["Item", "Sold", "Revenue", "Cost %", "Margin per unit", "Group"]} rows={rows.map((r) => [r.name, r.qty, r.revenueMinor / 10 ** exp, r.costPct, r.marginPerUnitMinor === null ? null : r.marginPerUnitMinor / 10 ** exp, r.group])} />}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((g) => (
            <button key={g} type="button" onClick={() => setGroup(group === g ? "ALL" : g)} aria-pressed={group === g} className={`rounded-xl border bg-card p-4 text-left transition ${group === g ? "ring-2 ring-primary" : "hover:border-primary/40"}`}>
              <div className="flex items-center justify-between"><span className="font-semibold">{GROUPS[g].label}</span><Badge variant="secondary" className={GROUPS[g].tone}>{counts(g)}</Badge></div>
              <p className="mt-1 text-xs text-muted-foreground">{GROUPS[g].help}</p>
            </button>
          ))}
        </div>
        {rows.some((r) => r.group === null) &&<p className="text-sm text-muted-foreground">{rows.filter((r) => r.group === null).length} item(s) have no recipe, so their margin is unknown. <button type="button" className="text-primary hover:underline" onClick={() => setGroup(group === "NONE" ? "ALL" : "NONE")}>{group === "NONE" ? "Show all" : "Show them"}</button></p>}
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Avg price</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Margin / unit</TableHead><TableHead>Group</TableHead></TableRow></TableHeader>
            <TableBody>
              {shown.length === 0 ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Nothing sold in {currency.code} for this period.</TableCell></TableRow>
                : shown.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.name}{r.kind === "combo" && <span className="ml-1.5 text-xs text-muted-foreground">deal</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.revenueMinor)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.avgPriceMinor)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.costPct === null ? "-" : `${r.costPct}%`}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.marginPerUnitMinor)}</TableCell>
                    <TableCell>{r.group ? <Badge variant="secondary" className={GROUPS[r.group].tone}>{GROUPS[r.group].label.replace(/s$/, "")}</Badge> : <span className="text-xs text-muted-foreground">No recipe</span>}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </div>
    </ReportPage>
  );
}
