import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../context/AuthContext";
import { useFetch } from "../hooks/useFetch";
import { api, errorMessage } from "../lib/api";
import { dateTime, isFinal, money, statusLabel } from "../lib/format";
import type { OrderStatus } from "../lib/types";
import { btnDanger, card, ErrorBox, PageTitle, Spinner, StatusBadge } from "../components/ui";

const steps: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "READY", "COMPLETED"];

export default function OrderDetailPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const [pollMs, setPollMs] = useState(10_000);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Poll so the customer sees the kitchen's status updates without refreshing.
  const { data, loading, error, reload, setData } = useFetch(() => api.orders.get(id), [id], { intervalMs: pollMs });
  const order = data?.data;

  // Stop polling once the order reaches a final state.
  useEffect(() => {
    if (order && isFinal(order.status)) setPollMs(0);
  }, [order]);

  async function cancel() {
    if (!confirm("Cancel this order?")) return;
    setBusy(true);
    setActionError(null);
    try {
      setData(await api.orders.cancel(id));
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !order) return <Spinner label="Loading your order…" />;
  if (error && !order) return <ErrorBox message={error} onRetry={reload} />;
  if (!order) return null;

  const stepIndex = steps.indexOf(order.status);

  return (
    <>
      <Link to="/orders" className="mb-4 inline-block text-sm text-ember underline">
        ← All orders
      </Link>
      <PageTitle sub={`Placed ${dateTime(order.createdAt)}`}>Order #{order.id}</PageTitle>

      <div className={`${card} mb-6 p-5`}>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-muted">Status</span>
          <StatusBadge status={order.status} />
        </div>
        {order.status === "CANCELLED" ? (
          <p className="text-sm text-red-700">This order was cancelled.</p>
        ) : (
          <ol className="grid grid-cols-5 gap-1 text-center text-xs" aria-label="Order progress">
            {steps.map((s, i) => (
              <li key={s}>
                <div className={`mb-1 h-1.5 rounded-full ${i <= stepIndex ? "bg-ember" : "bg-line"}`} />
                <span className={i === stepIndex ? "font-semibold text-ember" : "text-muted"}>{statusLabel[s]}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className={`${card} p-5`}>
        <h2 className="mb-3 font-display text-xl font-semibold">Items</h2>
        <ul className="divide-y divide-line">
          {order.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-4 py-2">
              <span>
                {i.quantity} × {i.menuItem.name}
                <span className="ml-2 text-sm text-muted">@ {money(i.unitPriceCents)}</span>
              </span>
              <span className="font-medium">{money(i.unitPriceCents * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-line pt-3 text-lg">
          <span className="font-display font-semibold">Total</span>
          <span className="font-display text-xl font-bold text-ember">{money(order.totalCents)}</span>
        </div>
        {order.notes && (
          <p className="mt-4 rounded-lg bg-cream p-3 text-sm">
            <span className="font-medium">Notes: </span>
            {order.notes}
          </p>
        )}
      </div>

      {actionError && <div className="mt-4"><ErrorBox message={actionError} /></div>}
      {order.status === "PENDING" && user?.id === order.userId && (
        <div className="mt-6">
          <button className={btnDanger} onClick={cancel} disabled={busy}>
            {busy ? "Cancelling…" : "Cancel order"}
          </button>
        </div>
      )}
    </>
  );
}
