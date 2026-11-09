import { useState } from "react";
import { btnDanger, btnPrimary, btnSecondary, ErrorBox, Spinner } from "../components/ui";
import { useFetch } from "../hooks/useFetch";
import { api, errorMessage } from "../lib/api";
import { canCancel, channelLabel, money, nextStatus, statusLabel, timeAgo } from "../lib/format";
import type { Order, OrderStatus } from "../lib/types";

// Kanban columns, left to right. Cancelled orders aren't shown on the board (see the dashboard).
const COLUMNS: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "READY", "COMPLETED"];
const HEAD: Record<string, string> = {
  PENDING: "border-amber-400",
  CONFIRMED: "border-sky-400",
  PREPARING: "border-orange-400",
  READY: "border-emerald-500",
  COMPLETED: "border-stone-400",
};
const COMPLETED_VISIBLE = 8; // keep the last column short

export default function AdminOrdersPage() {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // The API returns newest first; refresh every 15 seconds so new orders just appear.
  const { data, loading, error, reload } = useFetch(
    async () => {
      const res = await api.orders.list({ limit: 100 });
      setUpdatedAt(new Date());
      return res;
    },
    [],
    { intervalMs: 15_000 },
  );

  async function act(order: Order, fn: () => Promise<unknown>) {
    setBusyId(order.id);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(`Order #${order.id}: ${errorMessage(e)}`);
    } finally {
      setBusyId(null);
      reload(); // always resync with the server (it may have changed under us)
    }
  }

  const orders = data?.data ?? [];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Live order board</h1>
          <p className="text-muted">
            Click an order's button to move it to the next stage.
            {updatedAt && <> Updated {updatedAt.toLocaleTimeString()} · auto-refresh every 15 s.</>}
          </p>
        </div>
        <button className={btnSecondary} onClick={reload}>
          ↻ Refresh now
        </button>
      </div>

      {actionError && <div className="mb-4"><ErrorBox message={actionError} /></div>}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading orders…" />}

      {data && (
        <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
          {COLUMNS.map((status) => {
            const all = orders.filter((o) => o.status === status);
            const shown = status === "COMPLETED" ? all.slice(0, COMPLETED_VISIBLE) : all;
            return (
              <section key={status} aria-label={statusLabel[status]} className="w-72 shrink-0 rounded-2xl bg-stone-200/60 p-3 lg:w-auto" data-testid={`column-${status}`}>
                <h2 className={`mb-3 flex items-center justify-between border-b-4 pb-2 text-sm font-extrabold uppercase tracking-wide ${HEAD[status]}`}>
                  {statusLabel[status]}
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold">{all.length}</span>
                </h2>
                <div className="space-y-3">
                  {shown.length === 0 && <p className="py-6 text-center text-sm text-muted">No orders</p>}
                  {shown.map((o) => (
                    <OrderCard key={o.id} order={o} busy={busyId === o.id} onAct={act} />
                  ))}
                  {status === "COMPLETED" && all.length > shown.length && (
                    <p className="text-center text-xs text-muted">+ {all.length - shown.length} older completed</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function OrderCard({ order: o, busy, onAct }: { order: Order; busy: boolean; onAct: (o: Order, fn: () => Promise<unknown>) => void }) {
  const next = nextStatus[o.status];
  return (
    <article className="rounded-xl border border-line bg-paper p-3 shadow-sm" data-testid={`order-${o.id}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold">#{o.id}</p>
        <span className="rounded bg-cream px-1.5 py-0.5 text-[11px] font-semibold text-muted">{channelLabel[o.channel]}</span>
      </div>
      <p className="text-sm">{o.user.name}</p>
      <p className="text-xs text-muted">{timeAgo(o.createdAt)}</p>

      <ul className="mt-2 space-y-0.5 text-sm">
        {o.deals.map((d) => (
          <li key={`d${d.id}`}>
            {d.quantity}× {d.dealName} <span className="rounded bg-amber-400 px-1 text-[10px] font-extrabold text-black">DEAL</span>
          </li>
        ))}
        {o.items.map((i) => (
          <li key={i.id}>
            {i.quantity}× {i.menuItem.name}
          </li>
        ))}
      </ul>
      {o.notes && <p className="mt-2 rounded bg-amber-50 p-2 text-xs">📝 {o.notes}</p>}
      <p className="mt-2 font-extrabold text-ember">{money(o.totalCents)}</p>

      {(next || canCancel(o.status)) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {next && (
            <button className={`${btnPrimary} flex-1 px-2 py-1.5 text-xs`} disabled={busy} onClick={() => onAct(o, () => api.orders.setStatus(o.id, next))}>
              Move to {statusLabel[next]} →
            </button>
          )}
          {canCancel(o.status) && (
            <button
              className={`${btnDanger} px-2 py-1.5 text-xs`}
              disabled={busy}
              onClick={() => confirm(`Cancel order #${o.id}?`) && onAct(o, () => api.orders.cancel(o.id))}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </article>
  );
}
