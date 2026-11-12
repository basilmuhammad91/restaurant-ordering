import { ShieldAlert } from "lucide-react";
import { Tile } from "@/components/page/charts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportButton, ReportPage, useReport, useReportCurrency, useReportMoney } from "./shared";

interface Person { userId: string; name: string; voids: number; voidMinor: number; refunds: number; refundMinor: number; discounts: number; discountMinor: number; cashOuts: number; cashOutMinor: number; shortShifts: number; shortMinor: number; wasteEntries: number; wasteMinor: number; flags: string[] }
interface Meta { flagged: number; voidMinor: number; refundMinor: number; discountMinor: number; cashOutMinor: number; shortMinor: number }

/** Voids, refunds, discounts, cash taken out, till shortages and stock written off, per person. A flag is a reason to look, not proof. */
export default function FraudPage() {
  const currency = useReportCurrency();
  const q = useReport<Person[]>("/reports/fraud", currency.code);
  const { money, exp } = useReportMoney(currency.code);
  const people = q.data?.data ?? [];
  const meta = q.data?.meta as Meta | undefined;
  const cell = (count: number, minor: number) => (count === 0 ? <span className="text-muted-foreground">-</span> : <span className="tabular-nums">{count} <span className="text-xs text-muted-foreground">· {money(minor)}</span></span>);

  return (
    <ReportPage title="Fraud watch" description="Unusual activity by person." currency={currency} state={q}
      actions={<ExportButton name="fraud-watch" header={["Person", "Voids", "Void value", "Refunds", "Refund value", "Discounts", "Discount value", "Cash out", "Short shifts", "Flags"]} rows={people.map((p) => [p.name, p.voids, p.voidMinor / 10 ** exp, p.refunds, p.refundMinor / 10 ** exp, p.discounts, p.discountMinor / 10 ** exp, p.cashOuts, p.shortShifts, p.flags.join("; ")])} />}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label="People flagged" value={String(meta?.flagged ?? 0)} tone={meta?.flagged ? "bad" : "good"} hint="well above their colleagues" />
          <Tile label="Voided" value={money(meta?.voidMinor ?? 0)} />
          <Tile label="Refunded" value={money(meta?.refundMinor ?? 0)} />
          <Tile label="Manual discounts" value={money(meta?.discountMinor ?? 0)} />
        </div>
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Voids</TableHead><TableHead>Refunds</TableHead><TableHead>Discounts</TableHead><TableHead>Cash out</TableHead><TableHead>Till short</TableHead><TableHead>Written off</TableHead><TableHead>Flags</TableHead></TableRow></TableHeader>
            <TableBody>
              {people.length === 0 ? <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">No exceptions recorded in this period.</TableCell></TableRow>
                : people.map((p) => (
                  <TableRow key={p.userId}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{cell(p.voids, p.voidMinor)}</TableCell>
                    <TableCell>{cell(p.refunds, p.refundMinor)}</TableCell>
                    <TableCell>{cell(p.discounts, p.discountMinor)}</TableCell>
                    <TableCell>{cell(p.cashOuts, p.cashOutMinor)}</TableCell>
                    <TableCell>{cell(p.shortShifts, p.shortMinor)}</TableCell>
                    <TableCell>{cell(p.wasteEntries, p.wasteMinor)}</TableCell>
                    <TableCell><div className="flex flex-wrap gap-1">{p.flags.length === 0 ? <span className="text-xs text-muted-foreground">None</span> : p.flags.map((f) => <Badge key={f} variant="secondary" className="bg-red-500/15 text-red-700 dark:text-red-400"><ShieldAlert className="mr-1 size-3" />{f}</Badge>)}</div></TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent></Card>
        <p className="text-xs text-muted-foreground">A person is flagged when they are at least twice the average of everyone who had any activity, with a minimum number of events. Busy cashiers naturally have more of everything, so read flags alongside their sales.</p>
      </div>
    </ReportPage>
  );
}
