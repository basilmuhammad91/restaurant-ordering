import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { titleCase } from "@/components/cells";
import { ErrorState } from "@/components/page/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bars, DayChart, Tile } from "@/components/page/charts";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/features/pos/cart";
import { api, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useCurrencies } from "@/lib/money";
import { useScope } from "@/lib/scope";

interface Summary {
  currencyCode: string; orders: number; grossSalesMinor?: number; discountsMinor?: number; netSalesMinor?: number; taxMinor?: number; deliveryFeesMinor?: number; tipsMinor?: number; totalMinor?: number;
  averageOrderMinor?: number; collectedMinor?: number; byOrderType: Record<string, { orders: number; totalMinor: number }>; byChannel?: Record<string, { orders: number; totalMinor: number }>;
  byPaymentMethod?: { name: string; type: string; count: number; amountMinor: number }[]; byDay?: { date: string; orders: number; totalMinor: number }[];
  refunds?: { count: number; amountMinor: number }; voids?: { lines: number; amountMinor: number }; cancelled?: { orders: number; amountMinor: number };
}
interface DashboardData { financial: boolean; pipeline: Record<string, number>; currencies: Summary[] }

const PIPELINE = [["PENDING", "New"], ["CONFIRMED", "Confirmed"], ["PREPARING", "Preparing"], ["READY", "Ready"], ["OUT_FOR_DELIVERY", "Out"]] as const;

/** The sales numbers on the dashboard: totals, trend, and how they split. Follows the brand, branches and dates chosen in the top bar. */
export function SalesPanel() {
  const { brandId, effectiveLocationIds, availableLocations, range } = useScope();
  const { exponent } = useCurrencies();
  const me = useMe();
  // Which currency to show. The organization's own currency opens first; the choice is remembered on this device.
  const [picked, setPicked] = useState<string | null>(() => { try { return localStorage.getItem("restoflux_dash_currency"); } catch { return null; } });
  const everyBranch = effectiveLocationIds.length === availableLocations.length;
  const q = useQuery({
    queryKey: ["/dashboard/summary", brandId, everyBranch ? "all" : effectiveLocationIds.join(","), range.from, range.to],
    refetchInterval: 30_000,
    queryFn: async () => (await api.get<{ data: DashboardData }>("/dashboard/summary", { from: range.from, to: range.to, ...(brandId ? { brandId } : {}), ...(!everyBranch && effectiveLocationIds.length ? { locationIds: effectiveLocationIds } : {}) })).data,
  });

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (q.isPending) return <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>;
  const { financial, pipeline, currencies } = q.data;
  const live = PIPELINE.reduce((n, [s]) => n + (pipeline[s] ?? 0), 0);
  const codes = currencies.map((c) => c.currencyCode);
  const active = codes.includes(picked ?? "") ? picked! : codes.includes(me.tenant.baseCurrency) ? me.tenant.baseCurrency : codes[0];
  const choose = (code: string) => { setPicked(code); try { localStorage.setItem("restoflux_dash_currency", code); } catch { /* ignore */ } };
  const shownCurrencies = currencies.filter((c) => c.currencyCode === active);

  return (
    <div className="mb-6 space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Right now:</span>
        {live === 0 ? <span className="text-muted-foreground">no orders in progress</span> : PIPELINE.filter(([s]) => pipeline[s]).map(([s, label]) => <Link key={s} to="/orders/live" className="rounded-full border px-2.5 py-0.5 hover:bg-accent">{label} <span className="font-semibold">{pipeline[s]}</span></Link>)}
      </div>

      {currencies.length === 0 || currencies.every((c) => c.orders === 0) ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No orders in this period yet. Take an order at the <Link to="/pos" className="font-medium text-primary hover:underline">POS</Link> and the numbers appear here.</CardContent></Card>
      ) : shownCurrencies.map((c) => {
        const f = { symbol: c.currencyCode === "PKR" ? "Rs." : c.currencyCode, exponent: exponent(c.currencyCode) };
        const m = (n: number | undefined) => money(n ?? 0, f);
        return (
          <section key={c.currencyCode} className="space-y-4" aria-label={`Sales in ${c.currencyCode}`}>
            {currencies.length > 1 && (
              <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Currency">
                <span className="text-sm text-muted-foreground">Currency:</span>
                {codes.map((code) => <button key={code} type="button" role="tab" aria-selected={code === active} onClick={() => choose(code)} className={`rounded-full border px-3 py-1 text-sm ${code === active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{code}{code === me.tenant.baseCurrency ? " (default)" : ""}</button>)}
                <span className="text-xs text-muted-foreground">Each branch sells in its own currency, so totals are never mixed.</span>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {financial ? (
                <>
                  <Tile label="Net sales" value={m(c.netSalesMinor)} hint="after discounts, before tax" />
                  <Tile label="Orders" value={String(c.orders)} hint={`average ${m(c.averageOrderMinor)}`} />
                  <Tile label="Tax" value={m(c.taxMinor)} hint={c.discountsMinor ? `discounts ${m(c.discountsMinor)}` : undefined} />
                  <Tile label="Total collected" value={m(c.collectedMinor)} hint={c.refunds?.count ? `refunds ${m(c.refunds.amountMinor)}` : undefined} />
                </>
              ) : <Tile label="Orders" value={String(c.orders)} />}
            </div>
            {financial && (
              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2"><CardHeader><CardTitle className="text-base">Sales per day</CardTitle><CardDescription>Total sales (with tax) for each trading day.</CardDescription></CardHeader><CardContent><DayChart days={c.byDay ?? []} format={m} /></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-base">Order types</CardTitle></CardHeader><CardContent><Bars rows={Object.entries(c.byOrderType).map(([k, v]) => ({ label: titleCase(k), value: v.totalMinor, sub: `${v.orders}` }))} format={m} /></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-base">Payment methods</CardTitle></CardHeader><CardContent><Bars rows={(c.byPaymentMethod ?? []).map((p) => ({ label: p.name, value: p.amountMinor, sub: `${p.count}` }))} format={m} /></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-base">Channels</CardTitle></CardHeader><CardContent><Bars rows={Object.entries(c.byChannel ?? {}).map(([k, v]) => ({ label: titleCase(k), value: v.totalMinor, sub: `${v.orders}` }))} format={m} /></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-base">Leakage</CardTitle><CardDescription>Money that did not become sales.</CardDescription></CardHeader><CardContent className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Voided items ({c.voids?.lines ?? 0})</span><span className="tabular-nums">{m(c.voids?.amountMinor)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Cancelled orders ({c.cancelled?.orders ?? 0})</span><span className="tabular-nums">{m(c.cancelled?.amountMinor)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Refunds ({c.refunds?.count ?? 0})</span><span className="tabular-nums">{m(c.refunds?.amountMinor)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Discounts</span><span className="tabular-nums">{m(c.discountsMinor)}</span></div></CardContent></Card>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
