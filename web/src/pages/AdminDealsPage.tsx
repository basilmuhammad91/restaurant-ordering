import { useState, type FormEvent } from "react";
import { FoodImage } from "../components/FoodImage";
import { btnDanger, btnPrimary, btnSecondary, card, EmptyState, ErrorBox, Field, inputClass, Spinner } from "../components/ui";
import { useFetch } from "../hooks/useFetch";
import { api, ApiError, errorMessage } from "../lib/api";
import { isoToLocalInput, localInputToIso } from "../lib/dates";
import { money, percentOff } from "../lib/format";
import type { Deal, MenuItem } from "../lib/types";

function dealState(d: Deal): { label: string; className: string } {
  const now = Date.now();
  if (!d.isActive) return { label: "Off", className: "bg-stone-200 text-stone-700" };
  if (d.startsAt && new Date(d.startsAt).getTime() > now) return { label: "Scheduled", className: "bg-sky-100 text-sky-800" };
  if (d.endsAt && new Date(d.endsAt).getTime() < now) return { label: "Expired", className: "bg-red-100 text-red-700" };
  return { label: "Live", className: "bg-emerald-100 text-emerald-800" };
}

export default function AdminDealsPage() {
  const { data, loading, error, reload } = useFetch(async () => {
    const [deals, items] = await Promise.all([api.deals.manage(), api.menuItems.list()]);
    return { deals: deals.data, menuItems: items.data };
  }, []);
  const [editing, setEditing] = useState<"new" | number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function run(id: number, fn: () => Promise<unknown>) {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  const closeAndReload = () => {
    setEditing(null);
    reload();
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Deals</h1>
          <p className="text-muted">Bundle menu items at a discount. Customers see live deals on the home page.</p>
        </div>
        {data && editing === null && (
          <button className={btnPrimary} onClick={() => setEditing("new")}>
            + New deal
          </button>
        )}
      </div>

      {loading && !data && <Spinner label="Loading deals…" />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {actionError && <div className="mb-4"><ErrorBox message={actionError} /></div>}

      {data && editing === "new" && <DealForm menuItems={data.menuItems} onCancel={() => setEditing(null)} onSaved={closeAndReload} />}

      {data && data.deals.length === 0 && editing !== "new" && (
        <EmptyState title="No deals yet">Create your first deal to feature it on the home page.</EmptyState>
      )}

      {data && (
        <ul className="space-y-4">
          {data.deals.map((d) =>
            editing === d.id ? (
              <li key={d.id}>
                <DealForm deal={d} menuItems={data.menuItems} onCancel={() => setEditing(null)} onSaved={closeAndReload} />
              </li>
            ) : (
              <li key={d.id} className={`${card} flex flex-wrap items-center gap-4 p-4`}>
                <FoodImage src={d.imageUrl} name={d.name} fallback="🎁" className="h-16 w-16 shrink-0 rounded-xl text-3xl" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {d.name}{" "}
                    <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${dealState(d).className}`}>{dealState(d).label}</span>
                    {!d.available && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Item sold out</span>}
                  </p>
                  <p className="truncate text-sm text-muted">{d.items.map((i) => `${i.quantity}× ${i.menuItem.name}`).join(" · ")}</p>
                </div>
                <div className="text-right">
                  <p className="font-extrabold text-ember">{money(d.dealPriceCents)}</p>
                  <p className="text-xs text-muted">
                    <span className="line-through">{money(d.originalPriceCents)}</span> · {percentOff(d)}% off
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={btnSecondary} disabled={busyId === d.id} onClick={() => run(d.id, () => api.deals.update(d.id, { isActive: !d.isActive }))}>
                    {d.isActive ? "Turn off" : "Turn on"}
                  </button>
                  <button className={btnSecondary} onClick={() => setEditing(d.id)}>
                    Edit
                  </button>
                  <button
                    className={btnDanger}
                    disabled={busyId === d.id}
                    onClick={() => confirm(`Delete "${d.name}"? Deals that were ordered can't be deleted: turn them off instead.`) && run(d.id, () => api.deals.remove(d.id))}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </>
  );
}

const rupeesToCents = (s: string) => Math.round(parseFloat(s) * 100);
const validRupees = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.trim());

function DealForm({
  deal,
  menuItems,
  onSaved,
  onCancel,
}: {
  deal?: Deal;
  menuItems: MenuItem[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(deal?.name ?? "");
  const [description, setDescription] = useState(deal?.description ?? "");
  const [imageUrl, setImageUrl] = useState(deal?.imageUrl ?? "");
  const [dealPrice, setDealPrice] = useState(deal ? String(deal.dealPriceCents / 100) : "");
  // Blank = "use the sum of the parts". Editing keeps the stored original unless you clear it.
  const [originalPrice, setOriginalPrice] = useState(deal ? String(deal.originalPriceCents / 100) : "");
  const [isActive, setIsActive] = useState(deal?.isActive ?? true);
  const [startsAt, setStartsAt] = useState(isoToLocalInput(deal?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(isoToLocalInput(deal?.endsAt ?? null));
  const [lines, setLines] = useState<{ menuItemId: number; quantity: number }[]>(
    deal ? deal.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })) : [{ menuItemId: menuItems[0]?.id ?? 0, quantity: 1 }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const priceOf = new Map(menuItems.map((m) => [m.id, m.priceCents]));
  const partsCents = lines.reduce((s, l) => s + l.quantity * (priceOf.get(l.menuItemId) ?? 0), 0);
  const effectiveOriginal = originalPrice.trim() && validRupees(originalPrice) ? rupeesToCents(originalPrice) : partsCents;
  const previewOff = validRupees(dealPrice) ? percentOff({ dealPriceCents: rupeesToCents(dealPrice), originalPriceCents: effectiveOriginal }) : null;

  const updateLine = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const unused = menuItems.find((m) => !lines.some((l) => l.menuItemId === m.id));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = "Name is required";
    if (!validRupees(dealPrice)) local.dealPrice = "Enter a price like 1290";
    if (validRupees(dealPrice) && rupeesToCents(dealPrice) > effectiveOriginal) local.dealPrice = "Deal price can't exceed the original price";
    if (originalPrice.trim() && !validRupees(originalPrice)) local.originalPrice = "Enter a price like 1600, or leave blank";
    if (new Set(lines.map((l) => l.menuItemId)).size !== lines.length) local.items = "Each menu item can only be used once";
    if (lines.length === 0) local.items = "Add at least one item";
    if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) local.endsAt = "End must be after start";
    if (Object.keys(local).length) return setErrors(local);

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      imageUrl: imageUrl.trim() || null,
      dealPriceCents: rupeesToCents(dealPrice),
      ...(originalPrice.trim() && { originalPriceCents: rupeesToCents(originalPrice) }),
      isActive,
      startsAt: localInputToIso(startsAt),
      endsAt: localInputToIso(endsAt),
      items: lines,
    };

    setBusy(true);
    try {
      if (deal) await api.deals.update(deal.id, payload);
      else await api.deals.create(payload);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        const d = err.details;
        setErrors({
          ...(d.name?.[0] && { name: d.name[0] }),
          ...(d.imageUrl?.[0] && { imageUrl: d.imageUrl[0] }),
          ...(d.dealPriceCents?.[0] && { dealPrice: d.dealPriceCents[0] }),
          ...(d.items?.[0] && { items: d.items[0] }),
          ...(d.endsAt?.[0] && { endsAt: d.endsAt[0] }),
        });
      } else setFormError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className={`${card} mb-4 space-y-5 border-ember/40 p-5`}>
      <h2 className="text-xl font-bold">{deal ? `Edit "${deal.name}"` : "New deal"}</h2>
      {formError && <ErrorBox message={formError} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name}>
          <input className={inputClass} maxLength={150} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Image URL (optional)" error={errors.imageUrl}>
          <input className={inputClass} placeholder="https://…" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
        </Field>
      </div>
      <Field label="Description">
        <textarea className={inputClass} rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">What's in the deal</legend>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <select aria-label={`Item ${i + 1}`} className={inputClass} value={l.menuItemId} onChange={(e) => updateLine(i, { menuItemId: Number(e.target.value) })}>
                {menuItems.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({money(m.priceCents)}){m.available ? "" : " - sold out"}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Quantity ${i + 1}`}
                type="number"
                min={1}
                max={20}
                className={`${inputClass} w-20`}
                value={l.quantity}
                onChange={(e) => updateLine(i, { quantity: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
              />
              <button type="button" className={btnSecondary} aria-label={`Remove item ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                ✕
              </button>
            </div>
          ))}
        </div>
        {errors.items && <p className="mt-1 text-sm text-red-700">{errors.items}</p>}
        <button type="button" className={`${btnSecondary} mt-2`} disabled={!unused} onClick={() => unused && setLines((ls) => [...ls, { menuItemId: unused.id, quantity: 1 }])}>
          + Add item
        </button>
        <p className="mt-2 text-sm text-muted">Sum of the parts: {money(partsCents)}</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Deal price (Rs.)" error={errors.dealPrice}>
          <input className={inputClass} inputMode="decimal" value={dealPrice} onChange={(e) => setDealPrice(e.target.value)} />
        </Field>
        <Field label="Original price (Rs.)" error={errors.originalPrice}>
          <input className={inputClass} inputMode="decimal" placeholder={`auto: ${partsCents / 100}`} value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} />
        </Field>
        <div className="self-end pb-2 text-sm">
          {previewOff !== null && previewOff < 0 ? (
            <span className="font-semibold text-red-700">Above the original price</span>
          ) : previewOff !== null ? (
            <span className="rounded bg-amber-400 px-2 py-1 font-extrabold text-black">{previewOff}% OFF</span>
          ) : (
            <span className="text-muted">Enter a deal price</span>
          )}
        </div>
        <Field label="Starts (optional)">
          <input type="datetime-local" className={inputClass} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label="Ends (optional)" error={errors.endsAt}>
          <input type="datetime-local" className={inputClass} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-ember)]" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      </div>

      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy}>
          {busy ? "Saving…" : deal ? "Save changes" : "Create deal"}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
