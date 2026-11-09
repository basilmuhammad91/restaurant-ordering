import { useState, type FormEvent } from "react";
import { useFetch } from "../hooks/useFetch";
import { api, ApiError, errorMessage } from "../lib/api";
import { money } from "../lib/format";
import type { Category, MenuItem } from "../lib/types";
import { btnPrimary, btnSecondary, card, EmptyState, ErrorBox, Field, inputClass, PageTitle, Spinner } from "../components/ui";

export default function AdminMenuPage() {
  const { data, loading, error, reload } = useFetch(async () => {
    const [categories, items] = await Promise.all([api.categories.list(), api.menuItems.list()]);
    return { categories: categories.data, items: items.data };
  }, []);
  // `null` = form closed, "new" = creating, number = editing that item id
  const [editing, setEditing] = useState<"new" | number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function toggle(item: MenuItem) {
    setBusyId(item.id);
    setActionError(null);
    try {
      await api.menuItems.update(item.id, { available: !item.available });
      reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle sub="Add dishes, change prices and mark items sold out.">Manage menu</PageTitle>
        {data && editing === null && data.categories.length > 0 && (
          <button className={btnPrimary} onClick={() => setEditing("new")}>
            + Add item
          </button>
        )}
      </div>

      {loading && !data && <Spinner label="Loading the menu…" />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {actionError && <div className="mb-4"><ErrorBox message={actionError} /></div>}

      {data && data.categories.length === 0 && (
        <EmptyState title="No categories yet">
          Categories are created by the seed script: run <code className="rounded bg-cream px-1">npm run db:seed</code> in <code className="rounded bg-cream px-1">api/</code>.
        </EmptyState>
      )}

      {data && editing === "new" && (
        <ItemForm
          categories={data.categories}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      {data && (
        <ul className="space-y-3">
          {data.items.map((item) =>
            editing === item.id ? (
              <li key={item.id}>
                <ItemForm
                  item={item}
                  categories={data.categories}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    reload();
                  }}
                />
              </li>
            ) : (
              <li key={item.id} className={`${card} flex flex-wrap items-center gap-x-6 gap-y-3 p-4`}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {item.name}{" "}
                    <span className="ml-1 rounded-full bg-cream px-2 py-0.5 text-xs font-medium text-muted">{item.category.name}</span>
                  </p>
                  {item.description && <p className="truncate text-sm text-muted">{item.description}</p>}
                </div>
                <p className="font-display text-lg font-bold text-ember">{money(item.priceCents)}</p>
                <button
                  className={`${btnSecondary} w-36`}
                  disabled={busyId === item.id}
                  onClick={() => toggle(item)}
                  aria-pressed={item.available}
                  title="Toggle availability"
                >
                  {item.available ? "✓ Available" : "✕ Sold out"}
                </button>
                <button className={btnSecondary} onClick={() => setEditing(item.id)}>
                  Edit
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </>
  );
}

function ItemForm({
  item,
  categories,
  onSaved,
  onCancel,
}: {
  item?: MenuItem;
  categories: Category[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item ? (item.priceCents / 100).toFixed(2) : "");
  const [categoryId, setCategoryId] = useState<number>(item?.categoryId ?? categories[0]?.id ?? 0);
  const [available, setAvailable] = useState(item?.available ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);

    // The API stores money as integer cents; the form works in dollars.
    if (!/^\d+(\.\d{1,2})?$/.test(price.trim())) {
      setErrors({ price: "Enter a price like 12.50" });
      return;
    }
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      priceCents: Math.round(parseFloat(price) * 100),
      available,
      categoryId,
    };

    setBusy(true);
    try {
      if (item) await api.menuItems.update(item.id, payload);
      else await api.menuItems.create(payload);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        const d = err.details;
        setErrors({
          ...(d.name?.[0] && { name: d.name[0] }),
          ...(d.priceCents?.[0] && { price: d.priceCents[0] }),
          ...(d.description?.[0] && { description: d.description[0] }),
        });
      } else setFormError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={`${card} mb-4 space-y-4 border-ember/40 p-5`} noValidate>
      <h2 className="font-display text-xl font-semibold">{item ? `Edit "${item.name}"` : "New menu item"}</h2>
      {formError && <ErrorBox message={formError} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name}>
          <input className={inputClass} required maxLength={150} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Price (USD)" error={errors.price}>
          <input className={inputClass} inputMode="decimal" placeholder="12.50" required value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Category">
          <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-ember)]" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
          Available to order
        </label>
      </div>
      <Field label="Description" error={errors.description}>
        <textarea className={inputClass} rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy}>
          {busy ? "Saving…" : item ? "Save changes" : "Create item"}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
