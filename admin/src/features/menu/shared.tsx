import { PRICE_CHANNELS } from "@restoflux/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Search, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { titleCase } from "@/components/cells";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor, fromMinor, toMinor, useCurrencies } from "@/lib/money";
import { useAll, useInvalidate } from "@/lib/queries";
import { useScope } from "@/lib/scope";

// Small building blocks shared by the Menu screens.

export interface Brand { id: string; name: string }
export interface PriceBook { id: string; name: string; currencyCode: string; brandId: string | null }

export const useBrands = () => useAll<Brand>("/brands");

/** The brand a new item should default to: the one selected in the top bar, else the only brand. */
export function useDefaultBrandId(): string {
  const { brandId } = useScope();
  const brands = useBrands();
  return brandId ?? (brands.data?.length === 1 ? brands.data[0]!.id : "");
}

export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: ReactNode; error?: string | undefined; children: ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** A Radix Select cannot hold an empty value, so "none" is represented by a sentinel. */
const NONE = "__none__";
export function SimpleSelect({ value, onChange, options, placeholder = "Select…", allowEmpty, emptyLabel = "None", disabled, label, className = "w-full" }: { value: string | null | undefined; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; allowEmpty?: boolean; emptyLabel?: string; disabled?: boolean; label?: string; className?: string }) {
  return (
    <Select value={value || (allowEmpty ? NONE : "")} onValueChange={(v) => onChange(v === NONE ? "" : v)} disabled={disabled}>
      <SelectTrigger className={className} aria-label={label}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value={NONE}>{emptyLabel}</SelectItem>}
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Toggle chips for a fixed list (dietary tags, allergens, weekdays). */
export function ChipPicker<T extends string | number>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T[]; onChange: (v: T[]) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={String(o.value)} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>
            {on && <Check className="size-3" />} {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A searchable checklist for choosing several items (products on a menu, modifier groups on a product). */
export function ItemPicker({ items, selected, onChange, empty = "Nothing to choose from yet.", label }: { items: { id: string; name: string; hint?: string }[]; selected: string[]; onChange: (ids: string[]) => void; empty?: string; label: string }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())), [items, q]);
  const set = new Set(selected);
  return (
    <div className="rounded-lg border">
      <div className="relative border-b">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label}…`} className="h-9 rounded-none border-0 pl-9 shadow-none focus-visible:ring-0" aria-label={`Search ${label}`} />
      </div>
      <div className="max-h-56 divide-y overflow-y-auto">
        {items.length === 0 && <p className="p-3 text-sm text-muted-foreground">{empty}</p>}
        {shown.map((i) => (
          <label key={i.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={set.has(i.id)} onChange={(e) => onChange(e.target.checked ? [...selected, i.id] : selected.filter((x) => x !== i.id))} />
            <span className="min-w-0 flex-1 truncate">{i.name}</span>
            {i.hint && <span className="text-xs text-muted-foreground">{i.hint}</span>}
          </label>
        ))}
      </div>
      <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">{selected.length} selected</div>
    </div>
  );
}

// ---------------------------------------------------------------- prices
type TargetKey = "variantId" | "modifierOptionId" | "comboId" | "comboSlotOptionId";
interface PriceRow {
  id: string; priceBookId: string | null; locationId: string | null; channel: string | null; amountMinor: number; compareAtMinor: number | null; currencyCode: string;
  priceBook: { id: string; name: string } | null; location: { id: string; name: string; code: string } | null;
}

/**
 * Edits the prices of ONE thing (a size, an add-on option, a combo ...): a standard price per price book,
 * plus special prices for one branch and/or one channel (e.g. "Web orders cost 5% more").
 * Money is typed in normal units ("1250.50") and converted to integer minor units without floating point.
 */
export function PriceEditor({ targetKey, targetId, brandId, title, withCompareAt = false }: { targetKey: TargetKey; targetId: string; brandId: string; title: string; withCompareAt?: boolean }) {
  const { can, me } = useAuth();
  const canEdit = can("menu.price.edit");
  const { exponent } = useCurrencies();
  const invalidate = useInvalidate();
  const books = useAll<PriceBook>("/price-books");
  const key = ["/prices", targetKey, targetId];
  const prices = useQuery({ queryKey: key, queryFn: async () => (await api.get<{ data: PriceRow[] }>("/prices", { [targetKey]: targetId })).data });

  const myBooks = (books.data ?? []).filter((b) => !b.brandId || b.brandId === brandId);
  const branches = (me?.locations ?? []).filter((l) => l.type === "BRANCH" && l.brandId === brandId);
  const standard = (bookId: string) => prices.data?.find((p) => p.priceBookId === bookId && p.channel === null);
  const specials = (prices.data ?? []).filter((p) => p.locationId !== null || p.channel !== null);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [draftWas, setDraftWas] = useState<Record<string, string>>({});
  const valueOf = (bookId: string, cur: string) => draft[bookId] ?? (standard(bookId) ? fromMinor(standard(bookId)!.amountMinor, exponent(cur)) : "");
  const wasOf = (bookId: string, cur: string) => draftWas[bookId] ?? (standard(bookId)?.compareAtMinor ? fromMinor(standard(bookId)!.compareAtMinor!, exponent(cur)) : "");

  const refresh = async () => { await Promise.all([prices.refetch(), invalidate("/products", "/combos", "/modifier-groups")]); };

  const saveStandard = useMutation({
    mutationFn: async () => {
      const upserts: unknown[] = [];
      const removals: string[] = [];
      for (const b of myBooks) {
        const text = valueOf(b.id, b.currencyCode).trim();
        const existing = standard(b.id);
        if (!text) { if (existing) removals.push(existing.id); continue; }
        const amount = toMinor(text, exponent(b.currencyCode));
        if (amount === null) throw new Error(`Enter a valid price for ${b.name} (up to ${exponent(b.currencyCode)} decimals)`);
        const wasText = withCompareAt ? wasOf(b.id, b.currencyCode).trim() : "";
        const was = wasText ? toMinor(wasText, exponent(b.currencyCode)) : null;
        if (wasText && was === null) throw new Error(`Enter a valid "was" price for ${b.name}`);
        upserts.push({ target: { [targetKey]: targetId }, scope: { priceBookId: b.id }, amountMinor: amount, ...(was ? { compareAtMinor: was } : { compareAtMinor: null }) });
      }
      if (removals.length) await api.post("/prices/delete", { ids: removals });
      if (upserts.length) await api.put("/prices", { prices: upserts });
    },
    onSuccess: async () => { toast.success("Prices saved"); setDraft({}); setDraftWas({}); await refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // special price form
  const [scope, setScope] = useState("");
  const [channel, setChannel] = useState("");
  const [amount, setAmount] = useState("");
  const addSpecial = useMutation({
    mutationFn: async () => {
      const [kind, id] = scope.split(":");
      const cur = kind === "book" ? myBooks.find((b) => b.id === id)?.currencyCode : branches.find((l) => l.id === id)?.currencyCode;
      const minor = toMinor(amount, exponent(cur ?? "PKR"));
      if (!kind || !id) throw new Error("Choose where this price applies");
      if (minor === null) throw new Error("Enter a valid price");
      if (kind === "book" && !channel) throw new Error("A price book price with no channel is the standard price above");
      await api.put("/prices", { prices: [{ target: { [targetKey]: targetId }, scope: kind === "book" ? { priceBookId: id } : { locationId: id }, channel: channel || null, amountMinor: minor }] });
    },
    onSuccess: async () => { toast.success("Special price saved"); setAmount(""); await refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.post("/prices/delete", { ids: [id] }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const scopeOptions = [...myBooks.map((b) => ({ value: `book:${b.id}`, label: `Price book: ${b.name}` })), ...branches.map((l) => ({ value: `loc:${l.id}`, label: `Branch: ${l.name}` }))];

  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label={`Prices for ${title}`}>
      <h4 className="text-sm font-semibold">Prices: {title}</h4>
      {prices.isPending || books.isPending ? <p className="text-sm text-muted-foreground">Loading prices…</p> : myBooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">There is no price book for this brand yet. Create one under Organization, then set prices here.</p>
      ) : (
        <>
          <div className="space-y-2">
            {myBooks.map((b) => (
              <div key={b.id} className="grid items-center gap-2 sm:grid-cols-[1fr_9rem_9rem]">
                <Label className="text-sm font-normal">{b.name} <span className="text-xs text-muted-foreground">({b.currencyCode})</span></Label>
                <Input inputMode="decimal" placeholder="Not sold" aria-label={`${title} price in ${b.name}`} disabled={!canEdit} value={valueOf(b.id, b.currencyCode)} onChange={(e) => setDraft((d) => ({ ...d, [b.id]: e.target.value }))} />
                {withCompareAt && <Input inputMode="decimal" placeholder="Was (optional)" aria-label={`${title} was-price in ${b.name}`} disabled={!canEdit} value={wasOf(b.id, b.currencyCode)} onChange={(e) => setDraftWas((d) => ({ ...d, [b.id]: e.target.value }))} />}
              </div>
            ))}
            {canEdit && <Button size="sm" onClick={() => saveStandard.mutate()} disabled={saveStandard.isPending || (Object.keys(draft).length === 0 && Object.keys(draftWas).length === 0)}>{saveStandard.isPending ? "Saving…" : "Save prices"}</Button>}
            <p className="text-xs text-muted-foreground">Leave a price empty and the item is not sold under that price book.</p>
          </div>

          {(specials.length > 0 || canEdit) && (
            <div className="space-y-2 border-t pt-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Special prices</div>
              {specials.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-1.5 text-sm">
                  <span>{p.location ? `Branch ${p.location.name}` : `Book ${p.priceBook?.name}`}{p.channel ? ` · ${titleCase(p.channel)} orders` : " · all channels"}</span>
                  <span className="flex items-center gap-2 font-medium tabular-nums">{formatMinor(p.amountMinor, p.currencyCode, exponent(p.currencyCode))}
                    {canEdit && <button type="button" aria-label="Remove special price" onClick={() => remove.mutate(p.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>}
                  </span>
                </div>
              ))}
              {canEdit && (
                <div className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem_auto]">
                  <SimpleSelect value={scope} onChange={setScope} options={scopeOptions} placeholder="Applies to…" label="Special price scope" />
                  <SimpleSelect value={channel} onChange={setChannel} allowEmpty placeholder="Any channel" options={PRICE_CHANNELS.map((c) => ({ value: c, label: titleCase(c) }))} label="Channel" />
                  <Input inputMode="decimal" placeholder="Price" aria-label="Special price amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <Button size="sm" variant="outline" onClick={() => addSpecial.mutate()} disabled={addSpecial.isPending}>Add</Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
