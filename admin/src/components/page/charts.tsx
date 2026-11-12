// Small, honest charts used on the dashboard and the reports: no chart library, just bars you can read.

export function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" | "good" }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone === "bad" ? "text-red-600 dark:text-red-400" : tone === "good" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Horizontal bars: the simplest honest chart for "how is this split". */
export function Bars({ rows, format }: { rows: { label: string; value: number; sub?: string }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing yet in this period.</p>;
  return (
    <ul className="space-y-2" role="list">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between text-sm"><span>{r.label}{r.sub && <span className="ml-1 text-xs text-muted-foreground">{r.sub}</span>}</span><span className="font-medium tabular-nums">{format(r.value)}</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

/** Columns for a value per day. Hover (or focus) a column for the exact figure. */
export function DayChart({ days, format, className = "h-40" }: { days: { date: string; orders?: number; totalMinor: number }[]; format: (n: number) => string; className?: string }) {
  const max = Math.max(1, ...days.map((d) => d.totalMinor));
  if (days.length === 0) return <p className="text-sm text-muted-foreground">No sales in this period.</p>;
  return (
    <div className={`flex items-end gap-1 ${className}`} role="img" aria-label="Per day">
      {days.map((d) => (
        <div key={d.date} className="group relative flex h-full min-w-1 flex-1 flex-col justify-end" tabIndex={0} aria-label={`${d.date}: ${format(d.totalMinor)}${d.orders !== undefined ? `, ${d.orders} orders` : ""}`}>
          <div className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary group-focus:bg-primary" style={{ height: `${Math.max((d.totalMinor / max) * 100, 2)}%` }} />
          <div className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-xs shadow group-hover:block group-focus:block">{d.date.slice(5)}: {format(d.totalMinor)}</div>
        </div>
      ))}
    </div>
  );
}

/** 24 thin columns for the hours of the day; the busiest hours stand out. Hover or focus a column for the figure. */
export function HourChart({ hours, className = "h-28" }: { hours: { hour: number; orders: number; totalMinor: number }[]; className?: string }) {
  const max = Math.max(1, ...hours.map((h) => h.orders));
  return (
    <div>
      <div className={`flex items-end gap-0.5 ${className}`} role="img" aria-label="Orders per hour">
        {hours.map((h) => (
          <div key={h.hour} className="group relative flex h-full flex-1 flex-col justify-end" tabIndex={0} aria-label={`${String(h.hour).padStart(2, "0")}:00, ${h.orders} orders`}>
            <div className={`w-full rounded-t ${h.orders === max && h.orders > 0 ? "bg-primary" : "bg-primary/40"} group-hover:bg-primary`} style={{ height: `${h.orders ? Math.max((h.orders / max) * 100, 4) : 0}%` }} />
            <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-xs shadow group-hover:block group-focus:block">{String(h.hour).padStart(2, "0")}:00 · {h.orders}</div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
    </div>
  );
}
