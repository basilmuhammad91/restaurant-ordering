import { useState } from "react";
import { Link } from "react-router";
import { useFetch } from "../hooks/useFetch";
import { api } from "../lib/api";
import { dateTime, money } from "../lib/format";
import { card, EmptyState, ErrorBox, PageTitle, Pagination, Spinner, StatusBadge } from "../components/ui";

const LIMIT = 10;

export default function OrdersPage() {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch(() => api.orders.list({ page, limit: LIMIT }), [page]);

  return (
    <>
      <PageTitle>My orders</PageTitle>
      {loading && !data && <Spinner label="Loading your orders…" />}
      {error && <ErrorBox message={error} onRetry={reload} />}

      {data && data.data.length === 0 && (
        <EmptyState title="No orders yet">
          <Link to="/" className="text-brand underline">
            Place your first order
          </Link>
        </EmptyState>
      )}

      {data && data.data.length > 0 && (
        <>
          <ul className="space-y-3">
            {data.data.map((o) => (
              <li key={o.id}>
                <Link to={`/orders/${o.id}`} className={`${card} flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-brand/50`}>
                  <div>
                    <p className="font-semibold">Order #{o.id}</p>
                    <p className="text-sm text-muted">{dateTime(o.createdAt)}</p>
                    <p className="mt-1 text-sm text-muted">
                      {[...o.deals.map((d) => `${d.quantity}× ${d.dealName}`), ...o.items.map((i) => `${i.quantity}× ${i.menuItem.name}`)].join(", ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <StatusBadge status={o.status} />
                    <span className="font-display text-lg font-bold">{money(o.totalCents)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={data.meta.page} limit={data.meta.limit} total={data.meta.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
