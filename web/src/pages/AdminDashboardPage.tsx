import { useState, type ReactNode } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, Pie, PieChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { btnSecondary, card, ErrorBox, inputClass, Spinner } from "../components/ui";
import { useFetch } from "../hooks/useFetch";
import { api } from "../lib/api";
import { addDays, shortDay, todayKey } from "../lib/dates";
import { channelLabel, money, moneyShort, statusLabel } from "../lib/format";
import type { OrderChannel, OrderStatus } from "../lib/types";

const CHANNEL_COLOR: Record<OrderChannel, string> = { WEB: "#a3141c", ANDROID: "#f59e0b", IOS: "#3b82f6", POS: "#6b7280" };
const PIPELINE: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "READY", "COMPLETED", "CANCELLED"];
const PRESETS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

export default function AdminDashboardPage() {
  // undefined = let the API default to the last 30 days
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const { data, loading, error, reload } = useFetch(() => api.stats.get(range), [range.from, range.to], { intervalMs: 30_000 });

  const from = range.from ?? data?.range.from ?? "";
  const to = range.to ?? data?.range.to ?? "";
  const setPreset = (days: number) => {
    const end = todayKey();
    setRange({ from: addDays(end, -(days - 1)), to: end });
  };
  const change = (next: { from?: string; to?: string }) => {
    const f = next.from ?? from;
    const t = next.to ?? to;
    if (f && t && f <= t) setRange({ from: f, to: t });
  };

  const totalChannel = data?.channels.reduce((s, c) => s + c.count, 0) ?? 0;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-muted">Performance overview. Refreshes every 30 seconds.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button key={p.days} className={btnSecondary} onClick={() => setPreset(p.days)}>
              {p.label}
            </button>
          ))}
          <input aria-label="From date" type="date" className={`${inputClass} w-40!`} value={from} max={to || undefined} onChange={(e) => change({ from: e.target.value })} />
          <span className="text-muted">→</span>
          <input aria-label="To date" type="date" className={`${inputClass} w-40!`} value={to} min={from || undefined} onChange={(e) => change({ to: e.target.value })} />
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Crunching the numbers…" />}

      {data && (
        <div className="space-y-6">
          {/* Order pipeline: count and amount per status */}
          <section aria-label="Order pipeline" className="rounded-2xl bg-gradient-to-r from-brand-dark to-brand p-4 text-white shadow-lg">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {PIPELINE.map((s) => (
                <div key={s} className="rounded-xl bg-white/10 p-3 text-center ring-1 ring-white/15" data-testid={`pipeline-${s}`}>
                  <p className="text-3xl font-extrabold">{data.statuses[s].count}</p>
                  <p className="mx-auto mt-1 w-fit rounded bg-white/20 px-2 py-0.5 text-xs font-semibold">{money(data.statuses[s].amountCents)}</p>
                  <p className="mt-2 text-sm font-semibold">{statusLabel[s]}</p>
                </div>
              ))}
            </div>
          </section>

          {/* KPIs */}
          <section aria-label="Key figures" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Total orders" value={data.kpis.totalOrders.toLocaleString("en-PK")} />
            <Kpi label="Total sales" value={money(data.kpis.totalSalesCents)} tint />
            <Kpi label="Average order" value={money(data.kpis.averageOrderValueCents)} />
            <Kpi label="Cancelled rate" value={`${(data.kpis.cancelledRate * 100).toFixed(1)}%`} tint />
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Trend */}
            <Panel title="Daily orders and sales" className="lg:col-span-2">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 12 }} minTickGap={24} />
                    <YAxis yAxisId="orders" allowDecimals={false} tick={{ fontSize: 12 }} width={32} />
                    <YAxis yAxisId="sales" orientation="right" tickFormatter={(v: number) => moneyShort(v)} tick={{ fontSize: 12 }} width={64} />
                    <Tooltip
                      labelFormatter={(l) => shortDay(String(l))}
                      formatter={(v, name) => (name === "Sales" ? money(Number(v)) : String(v))}
                    />
                    <Bar yAxisId="orders" dataKey="orders" name="Orders" fill="#d9a3a6" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="sales" dataKey="salesCents" name="Sales" stroke="#a3141c" strokeWidth={2.5} dot={false} type="monotone" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted">Bars: orders per day. Line: sales per day (excludes cancelled orders).</p>
            </Panel>

            {/* Channels */}
            <Panel title="Orders by channel">
              <div className="relative mx-auto h-52 max-w-[13rem]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.channels} dataKey="count" nameKey="channel" innerRadius="68%" outerRadius="100%" paddingAngle={2} stroke="none">
                      {data.channels.map((c) => (
                        <Cell key={c.channel} fill={CHANNEL_COLOR[c.channel]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                  <div>
                    <p className="text-2xl font-extrabold">{totalChannel.toLocaleString("en-PK")}</p>
                    <p className="text-xs text-muted">Total</p>
                  </div>
                </div>
              </div>
              <ul className="mt-4 space-y-1.5 text-sm">
                {data.channels.map((c) => (
                  <li key={c.channel} className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: CHANNEL_COLOR[c.channel] }} />
                      {channelLabel[c.channel]}
                    </span>
                    <span className="text-muted">
                      {c.count} ({totalChannel ? ((c.count / totalChannel) * 100).toFixed(1) : "0.0"}%)
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          {/* Top items */}
          <Panel title="Top selling items">
            {data.topItems.length === 0 ? (
              <p className="text-sm text-muted">No sales in this period.</p>
            ) : (
              <ol className="space-y-3">
                {data.topItems.map((t, i) => (
                  <li key={t.menuItemId}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-semibold">
                        {i + 1}. {t.name}
                      </span>
                      <span className="text-muted">{t.quantity} sold</span>
                    </div>
                    <div className="h-2 rounded-full bg-cream">
                      <div className="h-2 rounded-full bg-brand" style={{ width: `${(t.quantity / data.topItems[0]!.quantity) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, tint = false }: { label: string; value: string; tint?: boolean }) {
  return (
    <div className={`rounded-2xl border border-line p-5 text-center shadow-sm ${tint ? "bg-amber-50" : "bg-paper"}`}>
      <p className="text-2xl font-extrabold tracking-tight sm:text-3xl">{value}</p>
      <p className="mt-1 text-sm text-muted">{label}</p>
    </div>
  );
}

function Panel({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`${card} p-5 ${className}`}>
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}
