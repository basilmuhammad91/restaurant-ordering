import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useCart } from "../context/CartContext";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { btnPrimary, btnSecondary, card, EmptyState, ErrorBox, inputClass, PageTitle } from "../components/ui";

export default function CheckoutPage() {
  const { lines, totalCents, clear } = useCart();
  const navigate = useNavigate();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (lines.length === 0) {
    return (
      <>
        <PageTitle>Checkout</PageTitle>
        <EmptyState title="Nothing to check out">
          <Link to="/" className="text-ember underline">
            Add something from the menu
          </Link>
        </EmptyState>
      </>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Only ids + quantities are sent: the server looks up prices itself.
      const { data: order } = await api.orders.create({
        items: lines.filter((l) => l.kind === "item").map((l) => ({ menuItemId: l.id, quantity: l.quantity })),
        deals: lines.filter((l) => l.kind === "deal").map((l) => ({ dealId: l.id, quantity: l.quantity })),
        ...(notes.trim() && { notes: notes.trim() }),
      });
      navigate(`/orders/${order.id}`, { replace: true });
      clear();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle>Checkout</PageTitle>
      <form onSubmit={onSubmit} className="grid gap-6 md:grid-cols-5">
        <section className={`${card} p-5 md:col-span-3`}>
          <h2 className="mb-3 font-display text-xl font-semibold">Order summary</h2>
          <ul className="divide-y divide-line">
            {lines.map((l) => (
              <li key={l.key} className="flex justify-between gap-4 py-2">
                <span>
                  {l.quantity} × {l.name}
                </span>
                <span className="font-medium">{money(l.priceCents * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between border-t border-line pt-3 text-lg">
            <span className="font-display font-semibold">Total</span>
            <span className="font-display text-xl font-bold text-ember">{money(totalCents)}</span>
          </div>
        </section>

        <section className={`${card} space-y-4 p-5 md:col-span-2`}>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Notes for the kitchen (optional)</span>
            <textarea
              className={inputClass}
              rows={4}
              maxLength={500}
              placeholder="Allergies, no onions, extra napkins…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <span className="mt-1 block text-right text-xs text-muted">{notes.length}/500</span>
          </label>
          {error && <ErrorBox message={error} />}
          <button className={`${btnPrimary} w-full`} disabled={busy}>
            {busy ? "Placing order…" : `Place order · ${money(totalCents)}`}
          </button>
          <Link to="/cart" className={`${btnSecondary} w-full`}>
            ← Back to cart
          </Link>
        </section>
      </form>
    </>
  );
}
