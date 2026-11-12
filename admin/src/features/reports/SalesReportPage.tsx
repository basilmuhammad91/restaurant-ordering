import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fmtDateTime, titleCase } from "@/components/cells";
import { Bars, DayChart, Tile } from "@/components/page/charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type Paged } from "@/lib/api";
import { useScope } from "@/lib/scope";
import { ExportButton, ReportPage, useReportCurrency, useReportMoney, useReportParams } from "./shared";

interface Summary {
  currencyCode: string; orders: number; grossSalesMinor: number; discountsMinor: number; netSalesMinor: number; taxMinor: number; deliveryFeesMinor: number; tipsMinor: number; totalMinor: number; averageOrderMinor: number; collectedMinor: number;
  byOrderType: Record<string, { orders: number; totalMinor: number }>; byChannel: Record<string, { orders: number; totalMinor: number }>;
  byPaymentMethod: { name: string; type: string; count: number; amountMinor: number; tipMinor: number }[]; byDay: { date: string; orders: number; totalMinor: number }[];
  refunds: { count: number; amountMinor: number }; voids: { lines: number; amountMinor: number }; cancelled: { orders: number; amountMinor: number };
}
type Group = "day" | "week" | "month";
const TABS = ["Overview", "By period", "By source", "Cancellations & refunds", "Tax & payments"] as const;

/** Monday of the week a date falls in. */
const weekStart = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const periodKey = (iso: string, g: Group) => (g === "day" ? iso : g === "week" ? weekStart(iso) : iso.slice(0, 7));

/** Sales for the chosen period: totals, by day/week/month, by order source, cancellations and refunds, tax and payments. */
export default function SalesReportPage() {
  const currency = useReportCurrency();
  const params = useReportParams(currency.code);
  const { range } = useScope();
  const { money, exp } = useReportMoney(currency.code);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [group, setGroup] = useState<Group>("day");
  const q = useQuery({ queryKey: ["/reports/sales-summary", "page", params], queryFn: async () => (await api.get<{ data: Summary[] }>("/reports/sales-summary", { from: params.from, to: params.to, ...(params.brandId ? { brandId: params.brandId } : {}), ...(params.locationIds ? { locationIds: params.locationIds } : {}) })).data });
  const cancelled = useQuery({ queryKey: ["/orders", "cancelled", range.from, range.to, params.locationIds, params.brandId], enabled: tab === "Cancellations & refunds", queryFn: () => api.get<Paged<{ id: string; orderNumber: string; placedAt: string; totalMinor: number; currencyCode: string; cancelNote: string | null; location: { name: string } }>>("/orders", { status: "CANCELLED", from: range.from, to: range.to, pageSize: 25, sort: "-placedAt", ...(params.locationIds ? { locationIds: params.locationIds } : {}) }) });
  const s = q.data?.find((x) => x.currencyCode === currency.code);

  const periods = new Map<string, { orders: number; totalMinor: number }>();
  for (const d of s?.byDay ?? []) { const k = periodKey(d.date, group); const p = periods.get(k) ?? { orders: 0, totalMinor: 0 }; p.orders += d.orders; p.totalMinor += d.totalMinor; periods.set(k, p); }
  const periodRows = [...periods.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, p]) => ({ period, ...p }));

  return (
    <ReportPage title="Sales" description="What was sold, how, and where it came from." currency={currency} state={q}
      actions={s && <ExportButton name={`sales-${range.from}-${range.to}`} header={["Period", "Orders", "Total sales"]} rows={periodRows.map((p) => [p.period, p.orders, p.totalMinor / 10 ** exp])} />}>
      {!s || s.orders === 0 ? <Card><CardContent className="p-6 text-sm text-muted-foreground">No sales in {currency.code} for this period.</CardContent></Card> : (
        <div className="space-y-4">
          <div className="inline-flex flex-wrap rounded-lg border p-0.5" role="tablist">{TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{t}</button>)}</div>

          {tab === "Overview" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Tile label="Net sales" value={money(s.netSalesMinor)} hint="after discounts, before tax" />
                <Tile label="Orders" value={String(s.orders)} hint={`average ${money(s.averageOrderMinor)}`} />
                <Tile label="Discounts" value={money(s.discountsMinor)} hint={s.grossSalesMinor ? `${((s.discountsMinor / s.grossSalesMinor) * 100).toFixed(1)}% of gross` : undefined} />
                <Tile label="Total collected" value={money(s.collectedMinor)} hint="including tax and tips" />
              </div>
              <Card><CardHeader><CardTitle className="text-base">Sales per day</CardTitle></CardHeader><CardContent><DayChart days={s.byDay} format={money} /></CardContent></Card>
            </>
          )}

          {tab === "By period" && (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">Sales by {group}</CardTitle><CardDescription>Total sales (with tax).</CardDescription></div>
                <div className="inline-flex rounded-lg border p-0.5">{(["day", "week", "month"] as const).map((g) => <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)} className={`rounded-md px-3 py-1 text-sm ${group === g ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{titleCase(g)}</button>)}</div></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>{group === "week" ? "Week starting" : titleCase(group)}</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Average order</TableHead></TableRow></TableHeader>
                  <TableBody>{periodRows.map((p) => <TableRow key={p.period}><TableCell className="font-medium">{p.period}</TableCell><TableCell className="text-right tabular-nums">{p.orders}</TableCell><TableCell className="text-right tabular-nums">{money(p.totalMinor)}</TableCell><TableCell className="text-right tabular-nums">{money(p.orders ? p.totalMinor / p.orders : 0)}</TableCell></TableRow>)}</TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {tab === "By source" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><CardHeader><CardTitle className="text-base">Channel</CardTitle><CardDescription>Where the order was taken.</CardDescription></CardHeader><CardContent><Bars rows={Object.entries(s.byChannel).map(([k, v]) => ({ label: titleCase(k), value: v.totalMinor, sub: `${v.orders} orders` }))} format={money} /></CardContent></Card>
              <Card><CardHeader><CardTitle className="text-base">Order type</CardTitle><CardDescription>Dine-in, takeaway or delivery.</CardDescription></CardHeader><CardContent><Bars rows={Object.entries(s.byOrderType).map(([k, v]) => ({ label: titleCase(k), value: v.totalMinor, sub: `${v.orders} orders` }))} format={money} /></CardContent></Card>
            </div>
          )}

          {tab === "Cancellations & refunds" && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Tile label="Cancelled orders" value={String(s.cancelled.orders)} hint={money(s.cancelled.amountMinor)} tone={s.cancelled.orders ? "bad" : undefined} />
                <Tile label="Voided items" value={String(s.voids.lines)} hint={money(s.voids.amountMinor)} tone={s.voids.lines ? "bad" : undefined} />
                <Tile label="Refunds" value={String(s.refunds.count)} hint={money(s.refunds.amountMinor)} tone={s.refunds.count ? "bad" : undefined} />
              </div>
              <Card><CardHeader><CardTitle className="text-base">Cancelled orders</CardTitle></CardHeader><CardContent>
                {(cancelled.data?.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">None in this period.</p> : (
                  <Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>When</TableHead><TableHead>Branch</TableHead><TableHead>Note</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
                    <TableBody>{cancelled.data!.data.filter((o) => o.currencyCode === currency.code).map((o) => <TableRow key={o.id}><TableCell className="font-medium">{o.orderNumber}</TableCell><TableCell className="text-muted-foreground">{fmtDateTime(o.placedAt)}</TableCell><TableCell>{o.location.name}</TableCell><TableCell>{o.cancelNote ?? "-"}</TableCell><TableCell className="text-right tabular-nums">{money(o.totalMinor)}</TableCell></TableRow>)}</TableBody></Table>
                )}
              </CardContent></Card>
            </>
          )}

          {tab === "Tax & payments" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><CardHeader><CardTitle className="text-base">Totals</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
                {([["Gross sales", s.grossSalesMinor], ["Discounts", -s.discountsMinor], ["Net sales", s.netSalesMinor], ["Tax", s.taxMinor], ["Delivery fees", s.deliveryFeesMinor], ["Tips", s.tipsMinor], ["Total", s.totalMinor]] as const).map(([label, v]) => <div key={label} className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{money(v)}</span></div>)}
              </CardContent></Card>
              <Card><CardHeader><CardTitle className="text-base">Payment methods</CardTitle><CardDescription>Money actually received.</CardDescription></CardHeader><CardContent><Bars rows={s.byPaymentMethod.map((p) => ({ label: p.name, value: p.amountMinor, sub: `${p.count}` }))} format={money} /></CardContent></Card>
            </div>
          )}
        </div>
      )}
    </ReportPage>
  );
}
