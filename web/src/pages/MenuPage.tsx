import { useMemo, useState } from "react";
import { useCart } from "../context/CartContext";
import { useFetch } from "../hooks/useFetch";
import { api } from "../lib/api";
import { money } from "../lib/format";
import type { MenuItem } from "../lib/types";
import { btnPrimary, btnSecondary, card, EmptyState, ErrorBox, PageTitle, Spinner } from "../components/ui";

export default function MenuPage() {
  const [selected, setSelected] = useState<number | null>(null);
  const { data, loading, error, reload } = useFetch(async () => {
    const [categories, items] = await Promise.all([api.categories.list(), api.menuItems.list()]);
    return { categories: categories.data, items: items.data };
  }, []);

  // Group items by category (only categories that actually have items), honouring the filter.
  const groups = useMemo(() => {
    if (!data) return [];
    return data.categories
      .filter((c) => selected === null || c.id === selected)
      .map((c) => ({ category: c, items: data.items.filter((i) => i.categoryId === c.id) }))
      .filter((g) => g.items.length > 0);
  }, [data, selected]);

  return (
    <>
      <PageTitle sub="Fresh, seasonal and made to order.">Our menu</PageTitle>

      {loading && <Spinner label="Loading the menu…" />}
      {error && <ErrorBox message={error} onRetry={reload} />}

      {data && data.items.length === 0 && (
        <EmptyState title="The menu is empty">Check back soon: the kitchen is still preparing it.</EmptyState>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="-mx-4 mb-8 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Categories">
            <FilterPill active={selected === null} onClick={() => setSelected(null)}>
              All
            </FilterPill>
            {data.categories.map((c) => (
              <FilterPill key={c.id} active={selected === c.id} onClick={() => setSelected(c.id)}>
                {c.name}
              </FilterPill>
            ))}
          </div>

          {groups.length === 0 && <EmptyState title="Nothing in this category yet" />}

          <div className="space-y-10">
            {groups.map(({ category, items }) => (
              <section key={category.id} aria-labelledby={`cat-${category.id}`}>
                <h2 id={`cat-${category.id}`} className="mb-4 border-b border-line pb-2 font-display text-2xl font-semibold">
                  {category.name}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {items.map((item) => (
                    <MenuCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition ${
        active ? "border-ember bg-ember text-white" : "border-line bg-paper hover:border-ember/50"
      }`}
    >
      {children}
    </button>
  );
}

function MenuCard({ item }: { item: MenuItem }) {
  const { lines, add } = useCart();
  const inCart = lines.find((l) => l.menuItemId === item.id)?.quantity ?? 0;

  return (
    <article className={`${card} flex flex-col justify-between gap-4 p-5 ${item.available ? "" : "opacity-60"}`}>
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-lg font-semibold">{item.name}</h3>
          <span className="font-display text-lg font-bold text-ember">{money(item.priceCents)}</span>
        </div>
        {item.description && <p className="mt-1 text-sm text-muted">{item.description}</p>}
      </div>
      {item.available ? (
        <button className={inCart ? btnSecondary : btnPrimary} onClick={() => add(item)}>
          {inCart ? `Add another (${inCart} in cart)` : "Add to cart"}
        </button>
      ) : (
        <button className={btnSecondary} disabled>
          Sold out
        </button>
      )}
    </article>
  );
}
