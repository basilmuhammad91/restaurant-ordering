import { Link } from "react-router";
import { useCart } from "../context/CartContext";
import { money } from "../lib/format";
import { btnDanger, btnPrimary, btnSecondary, card, EmptyState, PageTitle } from "../components/ui";

export default function CartPage() {
  const { lines, totalCents, setQuantity, remove, clear } = useCart();

  if (lines.length === 0) {
    return (
      <>
        <PageTitle>Your cart</PageTitle>
        <EmptyState title="Your cart is empty">
          <Link to="/" className="text-ember underline">
            Browse the menu
          </Link>{" "}
          to add something tasty.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageTitle>Your cart</PageTitle>
      <div className={`${card} divide-y divide-line`}>
        {lines.map((l) => (
          <div key={l.key} className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {l.name}
                {l.kind === "deal" && <span className="ml-2 rounded bg-amber-400 px-1.5 py-0.5 align-middle text-[10px] font-extrabold text-black">DEAL</span>}
              </p>
              <p className="text-sm text-muted">{money(l.priceCents)} each</p>
            </div>
            <div className="flex items-center gap-2">
              <button className={btnSecondary} aria-label={`Decrease ${l.name}`} onClick={() => setQuantity(l.key, l.quantity - 1)}>
                −
              </button>
              <span className="w-8 text-center font-semibold" aria-label={`Quantity of ${l.name}`}>
                {l.quantity}
              </span>
              <button className={btnSecondary} aria-label={`Increase ${l.name}`} onClick={() => setQuantity(l.key, l.quantity + 1)}>
                +
              </button>
            </div>
            <p className="w-20 text-right font-semibold">{money(l.priceCents * l.quantity)}</p>
            <button className={btnDanger} onClick={() => remove(l.key)}>
              Remove
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between p-4 text-lg">
          <span className="font-display font-semibold">Total</span>
          <span className="font-display text-2xl font-bold text-ember">{money(totalCents)}</span>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap justify-between gap-3">
        <button className={btnSecondary} onClick={clear}>
          Empty cart
        </button>
        <Link to="/checkout" className={btnPrimary}>
          Proceed to checkout →
        </Link>
      </div>
    </>
  );
}
