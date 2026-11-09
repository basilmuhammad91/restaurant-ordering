import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { BRAND } from "../brand";
import { FoodImage } from "../components/FoodImage";
import { btnPrimary, btnSecondary, card, EmptyState, ErrorBox, Spinner } from "../components/ui";
import { useCart } from "../context/CartContext";
import { useFetch } from "../hooks/useFetch";
import { api } from "../lib/api";
import { money, percentOff } from "../lib/format";
import type { Deal, MenuItem } from "../lib/types";

export default function HomePage() {
  const { hash } = useLocation();
  const [selected, setSelected] = useState<number | null>(null);
  const { data, loading, error, reload } = useFetch(async () => {
    const [categories, items, deals] = await Promise.all([api.categories.list(), api.menuItems.list(), api.deals.list()]);
    return { categories: categories.data, items: items.data, deals: deals.data };
  }, []);

  // Support /#menu and /#deals links from the header once the content has rendered.
  useEffect(() => {
    if (hash && data) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash, data]);

  const groups = useMemo(() => {
    if (!data) return [];
    return data.categories
      .filter((c) => selected === null || c.id === selected)
      .map((c) => ({ category: c, items: data.items.filter((i) => i.categoryId === c.id) }))
      .filter((g) => g.items.length > 0);
  }, [data, selected]);

  return (
    <>
      <Hero hasDeals={(data?.deals.length ?? 0) > 0} />

      <div className="mx-auto max-w-6xl space-y-16 px-4 py-14">
        {loading && <Spinner label="Loading today's menu…" />}
        {error && <ErrorBox message={error} onRetry={reload} />}

        {data && data.deals.length > 0 && (
          <section id="deals" className="scroll-mt-20" aria-labelledby="deals-title">
            <SectionTitle id="deals-title" title="Hot deals" sub="Bundles that cost less than the sum of their parts." />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {data.deals.map((d) => (
                <DealCard key={d.id} deal={d} />
              ))}
            </div>
          </section>
        )}

        {data && (
          <section id="menu" className="scroll-mt-20" aria-labelledby="menu-title">
            <SectionTitle id="menu-title" title="Our menu" sub="Made to order, always fresh." />
            {data.items.length === 0 ? (
              <EmptyState title="The menu is empty">Check back soon: the kitchen is still preparing it.</EmptyState>
            ) : (
              <>
                <div className="-mx-4 mb-8 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Categories">
                  <Pill active={selected === null} onClick={() => setSelected(null)}>
                    All
                  </Pill>
                  {data.categories.map((c) => (
                    <Pill key={c.id} active={selected === c.id} onClick={() => setSelected(c.id)}>
                      {c.name}
                    </Pill>
                  ))}
                </div>
                <div className="space-y-10">
                  {groups.map(({ category, items }) => (
                    <div key={category.id}>
                      <h3 className="mb-4 text-xl font-bold">{category.name}</h3>
                      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                        {items.map((item) => (
                          <MenuCard key={item.id} item={item} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </>
  );
}

function Hero({ hasDeals }: { hasDeals: boolean }) {
  return (
    <section className="relative overflow-hidden bg-night text-white">
      <div className="absolute inset-0 opacity-[0.08] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:22px_22px]" aria-hidden />
      <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand/30 blur-3xl" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
        <div>
          <p className="mb-4 inline-block rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white/70">
            Welcome to {BRAND.name}
          </p>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Hungry? Get hot, fresh food <span className="text-red-400">in minutes.</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-white/75">
            Order your favourites online for pickup or delivery. No waiting on the phone, no fuss: just pick, pay and enjoy.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#menu" className={`${btnPrimary} px-7 py-3 text-base`}>
              Order Now
            </a>
            {hasDeals && (
              <a href="#deals" className="inline-flex items-center rounded-lg border border-white/30 px-7 py-3 text-base font-semibold text-white transition hover:bg-white/10">
                See deals
              </a>
            )}
          </div>
        </div>
        <div className="hidden grid-cols-2 gap-4 md:grid" aria-hidden>
          {["🍕", "🍝", "🍰", "🍋"].map((e, i) => (
            <div
              key={e}
              className={`grid aspect-square place-items-center rounded-3xl bg-white/5 text-7xl ring-1 ring-white/10 ${i % 2 ? "translate-y-6" : ""}`}
            >
              {e}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionTitle({ id, title, sub }: { id: string; title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h2 id={id} className="text-3xl font-extrabold tracking-tight">
        {title}
      </h2>
      <p className="mt-1 text-muted">{sub}</p>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`shrink-0 rounded-full border px-5 py-2 text-sm font-semibold transition ${
        active ? "border-brand bg-brand text-white" : "border-line bg-paper hover:border-brand/50"
      }`}
    >
      {children}
    </button>
  );
}

function DealCard({ deal }: { deal: Deal }) {
  const { addDeal, quantityOf } = useCart();
  const inCart = quantityOf("deal", deal.id);
  const off = percentOff(deal);
  return (
    <article className={`${card} flex flex-col overflow-hidden ${deal.available ? "" : "opacity-60"}`}>
      <div className="relative">
        <FoodImage src={deal.imageUrl} name={deal.name} fallback="🎁" className="h-40 w-full" />
        {off > 0 && (
          <span className="absolute left-0 top-3 rounded-r-md bg-amber-400 px-2.5 py-1 text-xs font-extrabold text-black shadow">
            {off}% OFF
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="text-lg font-bold">{deal.name}</h3>
          {deal.description && <p className="mt-0.5 text-sm text-muted">{deal.description}</p>}
          <p className="mt-2 text-xs text-muted">{deal.items.map((i) => `${i.quantity}× ${i.menuItem.name}`).join(" · ")}</p>
        </div>
        <div className="mt-auto flex items-baseline gap-2">
          <span className="text-xl font-extrabold text-brand">{money(deal.dealPriceCents)}</span>
          <span className="text-sm text-muted line-through">{money(deal.originalPriceCents)}</span>
        </div>
        {deal.available ? (
          <button className={inCart ? btnSecondary : btnPrimary} onClick={() => addDeal(deal)}>
            {inCart ? `Add another (${inCart} in cart)` : "Add to cart"}
          </button>
        ) : (
          <button className={btnSecondary} disabled>
            Unavailable
          </button>
        )}
      </div>
    </article>
  );
}

function MenuCard({ item }: { item: MenuItem }) {
  const { addItem, quantityOf } = useCart();
  const inCart = quantityOf("item", item.id);
  return (
    <article className={`${card} flex flex-col overflow-hidden ${item.available ? "" : "opacity-60"}`}>
      <div className="relative">
        <FoodImage src={item.imageUrl} name={item.name} className="h-44 w-full" />
        {!item.available && <span className="absolute right-3 top-3 rounded-full bg-night/80 px-2.5 py-1 text-xs font-semibold text-white">Sold out</span>}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-lg font-bold">{item.name}</h4>
            <span className="shrink-0 text-lg font-extrabold text-brand">{money(item.priceCents)}</span>
          </div>
          {item.description && <p className="mt-1 text-sm text-muted">{item.description}</p>}
        </div>
        {item.available ? (
          <button className={`${inCart ? btnSecondary : btnPrimary} mt-auto`} onClick={() => addItem(item)}>
            {inCart ? `Add another (${inCart} in cart)` : "Add to cart"}
          </button>
        ) : (
          <button className={`${btnSecondary} mt-auto`} disabled>
            Sold out
          </button>
        )}
      </div>
    </article>
  );
}
