import { useState } from "react";
import { useFetch } from "../hooks/useFetch";
import { api, errorMessage } from "../lib/api";
import { canCancel, dateTime, money, nextStatus, statusLabel } from "../lib/format";
import type { Order, OrderStatus } from "../lib/types";
import { btnDanger, btnPrimary, card, EmptyState, ErrorBox, PageTitle, Pagination, Spinner, StatusBadge } from "../components/ui";

const LIMIT = 15;
const filters: Array<OrderStatus | "ALL"> = ["ALL", "PENDING", "CONFIRMED", "PREPARING", "READY", "COMPLETED", "CANCELLED"];

export default function AdminOrdersPage() {
  const [status, setStatus] = useState<OrderStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Newest first comes from the API. Refresh every 15s so new orders appear on their own.
  const { data, loading, error, reload } = useFetch(
    () => api.orders.list({ page, limit: LIMIT, ...(status !== "ALL" && { status }) }),
    [page, status],
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

  return (
    <>
      <PageTitle sub="All customer orders, newest first. Updates automatically.">Orders dashboard</PageTitle>

      <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => {
              setStatus(f);
              setPage(1);
            }}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
              status === f ? "border-ember bg-ember text-white" : "border-line bg-paper hover:border-ember/50"
            }`}
          >
            {f === "ALL" ? "All" : statusLabel[f]}
          </button>
        ))}
      </div>

      {actionError && <div className="mb-4"><ErrorBox message={actionError} /></div>}
      {loading && !data && <Spinner label="Loading orders…" />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.data.length === 0 && <EmptyState title="No orders here">Nothing matches this filter yet.</EmptyState>}

      {data && data.data.length > 0 && (
        <>
          <ul className="space-y-4">
            {data.data.map((o) => {
              const next = nextStatus[o.status];
              const busy = busyId === o.id;
              return (
                <li key={o.id} className={`${card} p-5`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold">
                        Order #{o.id} <StatusBadge status={o.status} />
                      </p>
                      <p className="text-sm text-muted">
                        {o.user.name} · {o.user.email} · {dateTime(o.createdAt)}
                      </p>
                    </div>
                    <p className="font-display text-xl font-bold text-ember">{money(o.totalCents)}</p>
                  </div>

                  <ul className="mt-3 text-sm">
                    {o.items.map((i) => (
                      <li key={i.id}>
                        {i.quantity} × {i.menuItem.name}
                      </li>
                    ))}
                  </ul>
                  {o.notes && <p className="mt-3 rounded-lg bg-cream p-3 text-sm"><span className="font-medium">Notes: </span>{o.notes}</p>}

                  {(next || canCancel(o.status)) && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {next && (
                        <button className={btnPrimary} disabled={busy} onClick={() => act(o, () => api.orders.setStatus(o.id, next))}>
                          Mark as {statusLabel[next]}
                        </button>
                      )}
                      {canCancel(o.status) && (
                        <button
                          className={btnDanger}
                          disabled={busy}
                          onClick={() => confirm(`Cancel order #${o.id}?`) && act(o, () => api.orders.cancel(o.id))}
                        >
                          Cancel order
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Pagination page={data.meta.page} limit={data.meta.limit} total={data.meta.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
