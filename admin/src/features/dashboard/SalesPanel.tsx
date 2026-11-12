import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Bike, ClipboardCheck, Clock, FileWarning, Package, PieChart, Star, Users, Wallet, Warehouse } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { fmtDateTime, titleCase } from "@/components/cells";
import { Bars, DayChart, HourChart } from "@/components/page/charts";
import { ErrorState } from "@/components/page/states";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/features/orders/common";
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
interface Insights {
  currencyCode: string;
  compare?: { previousNetSalesMinor: number; previousOrders: number; netSalesMinor: number; orders: number; previousFrom: string; previousTo: string };
  hours?: { hour: number; orders: number; totalMinor: number }[];
  topItems?: { name: string; qty: number; revenueMinor: number }[];
  recentOrders?: { id: string; number: string; at: string; totalMinor: number | null; status: string; orderType: string; branch: string }[];
  branches?: { name: string; orders: number; totalMinor: number }[];
  weekdays?: { day: number; orders: number; totalMinor: number }[];
  categories?: { name: string; revenueMinor: number }[];
  foodCost?: { pct: number | null; coveragePct: number };
  ops?: { stockValueMinor?: number; owedMinor?: number; labour?: { hours: number; costMinor: number }; customers?: { total: number; new: number; pointsOutstanding: number }; delivery?: { orders: number; completed: number; failed: number } };
  alerts?: { approvals?: number; openShifts?: number; deliveriesWaiting?: number; lowStock?: number; overdueInvoices?: { count: number; amountMinor: number }; feedback?: { count: number; newCount: number; average: number | null }; clockedIn?: number };
}

const PIPELINE = [["PENDING", "New"], ["CONFIRMED", "Confirmed"], ["PREPARING", "Preparing"], ["READY", "Ready"], ["OUT_FOR_DELIVERY", "Out"]] as const;

/** A compact figure: label, value, and how it moved against the period before. */
function Kpi({ label, value, hint, delta }: { label: string; value: string; hint?: string; delta?: number | null }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5"><span className="text-lg font-semibold leading-tight tabular-nums">{value}</span>
        {delta !== undefined && delta !== null && (
          <span className={`inline-flex items-center text-xs font-medium ${delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} title="Compared with the period just before">{delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{Math.abs(delta).toFixed(0)}%</span>
        )}
      </div>
      {hint && <div className="truncate text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Panel({ title, sub, children, className = "" }: { title: string; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border bg-card p-3 ${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">{title}</h2>{sub && <span className="text-xs text-muted-foreground">{sub}</span>}</div>
      {children}
    </section>
  );
}

/** A small linked card for an operations number (stock value, supplier balance, labour...). */
function OpsCard({ to, icon, label, value, hint, tone }: { to: string; icon: ReactNode; label: string; value: string; hint?: string; tone?: "bad" }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2 transition-colors hover:border-primary/40">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
        <span className={`block truncate text-sm font-semibold leading-tight tabular-nums ${tone === "bad" ? "text-red-600 dark:text-red-400" : ""}`}>{value}</span>
        {hint && <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </Link>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pctChange = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

/** Small "needs attention" pills. Only those the person can act on are returned by the API. */
function Attention({ a, fmt }: { a: NonNullable<Insights["alerts"]>; fmt: (n: number) => string }) {
  const items: { key: string; to: string; icon: ReactNode; text: string; tone: "warn" | "info" }[] = [];
  if (a.approvals) items.push({ key: "ap", to: "/approvals", icon: <ClipboardCheck className="size-3.5" />, text: `${a.approvals} waiting for approval`, tone: "warn" });
  if (a.deliveriesWaiting) items.push({ key: "dl", to: "/delivery", icon: <Bike className="size-3.5" />, text: `${a.deliveriesWaiting} deliver${a.deliveriesWaiting === 1 ? "y needs" : "ies need"} a rider`, tone: "warn" });
  if (a.lowStock) items.push({ key: "ls", to: "/inventory/stock", icon: <Package className="size-3.5" />, text: `${a.lowStock} item${a.lowStock === 1 ? "" : "s"} low on stock`, tone: "warn" });
  if (a.overdueInvoices?.count) items.push({ key: "oi", to: "/purchasing/invoices", icon: <FileWarning className="size-3.5" />, text: `${fmt(a.overdueInvoices.amountMinor)} overdue to suppliers`, tone: "warn" });
  if (a.feedback?.newCount) items.push({ key: "fb", to: "/marketing/feedback", icon: <Star className="size-3.5" />, text: `${a.feedback.newCount} feedback to answer`, tone: "warn" });
  if (a.openShifts !== undefined) items.push({ key: "os", to: "/shifts", icon: <Wallet className="size-3.5" />, text: `${a.openShifts} open shift${a.openShifts === 1 ? "" : "s"}`, tone: "info" });
  if (a.clockedIn !== undefined) items.push({ key: "ci", to: "/staff/timeclock", icon: <Clock className="size-3.5" />, text: `${a.clockedIn} on the clock`, tone: "info" });
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Needs attention">
      {items.map((i) => (
        <Link key={i.key} to={i.to} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-accent ${i.tone === "warn" ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300" : "text-muted-foreground"}`}>{i.icon}{i.text}</Link>
      ))}
    </div>
  );
}

/** The dashboard's numbers: attention list, key figures with a comparison, trend, busiest hours, best sellers and the latest orders. Follows the brand, branches and dates chosen in the top bar. */
export function SalesPanel() {
  const { brandId, effectiveLocationIds, availableLocations, range } = useScope();
  const { exponent } = useCurrencies();
  const me = useMe();
  // Which currency to show. The organization's own currency opens first; the choice is remembered on this device.
  const [picked, setPicked] = useState<string | null>(() => { try { return localStorage.getItem("restoflux_dash_currency"); } catch { return null; } });
  const everyBranch = effectiveLocationIds.length === availableLocations.length;
  const scopeParams = { from: range.from, to: range.to, ...(brandId ? { brandId } : {}), ...(!everyBranch && effectiveLocationIds.length ? { locationIds: effectiveLocationIds } : {}) };
  const q = useQuery({
    queryKey: ["/dashboard/summary", brandId, everyBranch ? "all" : effectiveLocationIds.join(","), range.from, range.to],
    refetchInterval: 30_000,
    queryFn: async () => (await api.get<{ data: DashboardData }>("/dashboard/summary", scopeParams)).data,
  });
  const codes = (q.data?.currencies ?? []).map((c) => c.currencyCode);
  const active = codes.includes(picked ?? "") ? picked! : codes.includes(me.tenant.baseCurrency) ? me.tenant.baseCurrency : codes[0] ?? me.tenant.baseCurrency;
  const insights = useQuery({
    queryKey: ["/dashboard/insights", brandId, everyBranch ? "all" : effectiveLocationIds.join(","), range.from, range.to, active],
    enabled: !!q.data, refetchInterval: 60_000,
    queryFn: async () => (await api.get<{ data: Insights }>("/dashboard/insights", { ...scopeParams, currencyCode: active })).data,
  });

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (q.isPending) return <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>;
  const { financial, pipeline, currencies } = q.data;
  const live = PIPELINE.reduce((n, [s]) => n + (pipeline[s] ?? 0), 0);
  const choose = (code: string) => { setPicked(code); try { localStorage.setItem("restoflux_dash_currency", code); } catch { /* ignore */ } };
  const c = currencies.find((x) => x.currencyCode === active);
  const f = { symbol: active === "PKR" ? "Rs." : active, exponent: exponent(active) };
  const m = (n: number | undefined) => money(n ?? 0, f);
  const ins = insights.data;
  const cmp = ins?.compare;

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium">Right now:</span>
          {live === 0 ? <span className="text-muted-foreground">no orders in progress</span> : PIPELINE.filter(([s]) => pipeline[s]).map(([s, label]) => <Link key={s} to="/orders/live" className="rounded-full border px-2 py-0.5 text-xs hover:bg-accent">{label} <span className="font-semibold">{pipeline[s]}</span></Link>)}
        </div>
        {currencies.length > 1 && (
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Currency">
            {codes.map((code) => <button key={code} type="button" role="tab" aria-selected={code === active} title={code === me.tenant.baseCurrency ? "Your organization's currency" : "Each branch sells in its own currency, so totals are never mixed."} onClick={() => choose(code)} className={`rounded-full border px-2.5 py-0.5 text-xs ${code === active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{code}{code === me.tenant.baseCurrency ? " ★" : ""}</button>)}
          </div>
        )}
      </div>

      {ins?.alerts && <Attention a={ins.alerts} fmt={m} />}

      {!c || c.orders === 0 ? (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">No orders in {active} for this period yet. Take an order at the <Link to="/pos" className="font-medium text-primary hover:underline">POS</Link> and the numbers appear here.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {financial ? (
              <>
                <Kpi label="Net sales" value={m(c.netSalesMinor)} hint="after discounts, before tax" delta={cmp ? pctChange(cmp.netSalesMinor, cmp.previousNetSalesMinor) : null} />
                <Kpi label="Orders" value={String(c.orders)} hint={`average ${m(c.averageOrderMinor)}`} delta={cmp ? pctChange(cmp.orders, cmp.previousOrders) : null} />
                <Kpi label="Collected" value={m(c.collectedMinor)} hint={c.refunds?.count ? `refunds ${m(c.refunds.amountMinor)}` : "tax and tips included"} />
                <Kpi label="Discounts" value={m(c.discountsMinor)} hint={c.grossSalesMinor ? `${(((c.discountsMinor ?? 0) / c.grossSalesMinor) * 100).toFixed(1)}% of gross` : undefined} />
                <Kpi label="Tax" value={m(c.taxMinor)} />
                <Kpi label="Tips" value={m(c.tipsMinor)} hint={c.deliveryFeesMinor ? `delivery ${m(c.deliveryFeesMinor)}` : undefined} />
              </>
            ) : <Kpi label="Orders" value={String(c.orders)} />}
          </div>

          {ins?.ops && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
              {ins.foodCost && <OpsCard to="/reports/food-cost" icon={<PieChart className="size-4" />} label="Food cost" value={ins.foodCost.pct === null ? "-" : `${ins.foodCost.pct}%`} hint={ins.foodCost.coveragePct < 100 ? `${ins.foodCost.coveragePct}% of sales costed` : "of sales, from recipes"} />}
              {ins.ops.stockValueMinor !== undefined && <OpsCard to="/inventory/stock" icon={<Warehouse className="size-4" />} label="Stock value" value={m(ins.ops.stockValueMinor)} hint={ins.alerts?.lowStock ? `${ins.alerts.lowStock} low` : "nothing low"} tone={ins.alerts?.lowStock ? "bad" : undefined} />}
              {ins.ops.owedMinor !== undefined && <OpsCard to="/purchasing/invoices" icon={<Wallet className="size-4" />} label="Payables" value={m(ins.ops.owedMinor)} hint={ins.alerts?.overdueInvoices?.count ? `${m(ins.alerts.overdueInvoices.amountMinor)} overdue` : "none overdue"} tone={ins.alerts?.overdueInvoices?.count ? "bad" : undefined} />}
              {ins.ops.labour && <OpsCard to="/staff/timeclock" icon={<Clock className="size-4" />} label="Labour" value={m(ins.ops.labour.costMinor)} hint={`${ins.ops.labour.hours} h${c.netSalesMinor ? ` · ${((ins.ops.labour.costMinor / c.netSalesMinor) * 100).toFixed(0)}% of sales` : ""}`} />}
              {ins.ops.customers && <OpsCard to="/customers" icon={<Users className="size-4" />} label="Customers" value={String(ins.ops.customers.total)} hint={`${ins.ops.customers.new} new · ${ins.ops.customers.pointsOutstanding} points out`} />}
              {ins.alerts?.feedback && <OpsCard to="/marketing/feedback" icon={<Star className="size-4" />} label="Guest rating" value={ins.alerts.feedback.average ? `${ins.alerts.feedback.average} / 5` : "-"} hint={`${ins.alerts.feedback.count} response${ins.alerts.feedback.count === 1 ? "" : "s"}`} tone={ins.alerts.feedback.average && ins.alerts.feedback.average < 3 ? "bad" : undefined} />}
              {ins.ops.delivery && <OpsCard to="/delivery" icon={<Bike className="size-4" />} label="Deliveries" value={String(ins.ops.delivery.orders)} hint={`${ins.ops.delivery.completed} done${ins.ops.delivery.failed ? ` · ${ins.ops.delivery.failed} failed` : ""}`} tone={ins.ops.delivery.failed ? "bad" : undefined} />}
            </div>
          )}

          {financial && (
            <div className="grid gap-3 lg:grid-cols-3">
              <Panel title="Sales per day" sub="with tax" className="lg:col-span-2"><DayChart days={c.byDay ?? []} format={m} className="h-28" /></Panel>
              <Panel title="Busiest hours" sub="orders, by hour of day">{ins?.hours ? <HourChart hours={ins.hours} /> : <Skeleton className="h-28 w-full" />}</Panel>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {financial && (
              <Panel title="Best sellers" sub="by sales">
                {!ins?.topItems ? <Skeleton className="h-24 w-full" /> : ins.topItems.length === 0 ? <p className="text-sm text-muted-foreground">Nothing sold yet.</p> : (
                  <ol className="space-y-1 text-sm">{ins.topItems.map((t, i) => <li key={t.name} className="flex items-baseline justify-between gap-2"><span className="truncate"><span className="mr-1.5 text-xs text-muted-foreground">{i + 1}</span>{t.name}</span><span className="shrink-0 tabular-nums text-muted-foreground"><span className="mr-2 text-xs">{t.qty} sold</span><span className="font-medium text-foreground">{m(t.revenueMinor)}</span></span></li>)}</ol>
                )}
              </Panel>
            )}
            {financial && (
              <Panel title="How people order">
                <Bars rows={[...Object.entries(c.byOrderType).map(([k, v]) => ({ label: titleCase(k), value: v.totalMinor, sub: `${v.orders}` })), ...Object.entries(c.byChannel ?? {}).filter(([k]) => k !== "POS").map(([k, v]) => ({ label: titleCase(k), value: v.totalMinor, sub: `${v.orders}` }))]} format={m} />
              </Panel>
            )}
            {financial && <Panel title="Payment methods"><Bars rows={(c.byPaymentMethod ?? []).map((p) => ({ label: p.name, value: p.amountMinor, sub: `${p.count}` }))} format={m} /></Panel>}
            {ins?.recentOrders && (
              <Panel title="Latest orders" sub={<Link to="/orders/history" className="text-primary hover:underline">see all</Link>}>
                {ins.recentOrders.length === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p> : (
                  <ul className="space-y-1.5 text-sm">{ins.recentOrders.map((o) => <li key={o.id} className="flex items-center justify-between gap-2"><span className="min-w-0 truncate"><span className="font-medium">{o.number}</span> <span className="text-xs text-muted-foreground">{fmtDateTime(o.at).slice(-5)}</span></span><span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap"><StatusBadge status={o.status} />{o.totalMinor !== null && <span className="tabular-nums">{m(o.totalMinor)}</span>}</span></li>)}</ul>
                )}
              </Panel>
            )}
          </div>

          {financial && (ins?.categories || ins?.branches || ins?.weekdays) && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {ins.categories && ins.categories.length > 0 && <Panel title="Sales by category" sub="before tax"><Bars rows={ins.categories.map((x) => ({ label: x.name, value: x.revenueMinor }))} format={m} /></Panel>}
              {ins.branches && ins.branches.length > 1 && <Panel title="Branch comparison" sub="total sales"><Bars rows={ins.branches.map((b) => ({ label: b.name, value: b.totalMinor, sub: `${b.orders}` }))} format={m} /></Panel>}
              {ins.weekdays && ins.weekdays.some((d) => d.orders > 0) && <Panel title="Day of the week" sub="total sales"><Bars rows={ins.weekdays.map((d) => ({ label: WEEKDAYS[d.day]!, value: d.totalMinor, sub: `${d.orders}` }))} format={m} /></Panel>}
            </div>
          )}

          {financial && ((c.voids?.lines ?? 0) > 0 || (c.cancelled?.orders ?? 0) > 0 || (c.refunds?.count ?? 0) > 0) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 font-medium text-foreground"><AlertTriangle className="size-3.5" /> Leakage</span>
              <span>Voids {c.voids?.lines ?? 0} · {m(c.voids?.amountMinor)}</span>
              <span>Cancelled {c.cancelled?.orders ?? 0} · {m(c.cancelled?.amountMinor)}</span>
              <span>Refunds {c.refunds?.count ?? 0} · {m(c.refunds?.amountMinor)}</span>
              <Link to="/reports/fraud" className="ml-auto text-primary hover:underline">Fraud watch</Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
