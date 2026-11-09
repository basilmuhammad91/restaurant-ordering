import { zodResolver } from "@hookform/resolvers/zod";
import { comboInputSchema } from "@restoflux/contracts";
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Plus, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch, type Control, type UseFormRegister } from "react-hook-form";
import { toast } from "sonner";
import { Can } from "@/components/Can";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ActiveBadge, fmtDate } from "@/components/cells";
import { DataTable } from "@/components/data-table/DataTable";
import { useTableState } from "@/components/data-table/useTableState";
import { PageHeader } from "@/components/page/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatMinor, useCurrencies } from "@/lib/money";
import { useAll, useInvalidate, useList } from "@/lib/queries";
import { useScope } from "@/lib/scope";
import { Field, PriceEditor, SimpleSelect, useBrands, useDefaultBrandId } from "./shared";

interface SlotOption { id: string; variantId: string; isDefault: boolean; variant: { id: string; name: string; product: { id: string; name: string } } }
interface Slot { id: string; name: string; quantity: number; options: SlotOption[] }
interface Combo {
  id: string; brandId: string; name: string; description: string | null; imageUrl: string | null; taxCategoryId: string | null; isActive: boolean;
  startsAt: string | null; endsAt: string | null; deletedAt: string | null; slots: Slot[];
  priceRange: { minMinor: number; maxMinor: number; currencyCode: string } | null;
}

interface FormValues {
  brandId: string; name: string; description: string; imageUrl: string; taxCategoryId: string; isActive: boolean; startsAt: string; endsAt: string;
  slots: { id?: string; name: string; quantity: number; options: { id?: string; variantId: string; isDefault: boolean }[] }[];
}
const blank = (brandId: string): FormValues => ({ brandId, name: "", description: "", imageUrl: "", taxCategoryId: "", isActive: true, startsAt: "", endsAt: "", slots: [{ name: "", quantity: 1, options: [{ variantId: "", isDefault: true }] }] });
const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : "");
const toForm = (c: Combo): FormValues => ({
  brandId: c.brandId, name: c.name, description: c.description ?? "", imageUrl: c.imageUrl ?? "", taxCategoryId: c.taxCategoryId ?? "", isActive: c.isActive,
  startsAt: toLocalInput(c.startsAt), endsAt: toLocalInput(c.endsAt),
  slots: c.slots.map((s) => ({ id: s.id, name: s.name, quantity: s.quantity, options: s.options.map((o) => ({ id: o.id, variantId: o.variantId, isDefault: o.isDefault })) })),
});
const clean = (v: FormValues) => ({
  ...v, description: v.description.trim() || null, imageUrl: v.imageUrl.trim() || null, taxCategoryId: v.taxCategoryId || null,
  startsAt: v.startsAt ? new Date(v.startsAt).toISOString() : null, endsAt: v.endsAt ? new Date(v.endsAt).toISOString() : null,
});

function SlotEditor({ index, control, register, remove, canRemove, variantOptions, onChangeDefault }: {
  index: number; control: Control<FormValues>; register: UseFormRegister<FormValues>; remove: () => void; canRemove: boolean;
  variantOptions: { value: string; label: string }[]; onChangeDefault: (slot: number, option: number) => void;
}) {
  const options = useFieldArray({ control, name: `slots.${index}.options` });
  const values = useWatch({ control, name: `slots.${index}.options` });
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="grid items-center gap-2 sm:grid-cols-[1fr_6rem_auto]">
        <Input placeholder="Slot name (e.g. Burger, Drink)" aria-label={`Slot ${index + 1} name`} {...register(`slots.${index}.name`)} />
        <Input type="number" min={1} aria-label={`Slot ${index + 1} quantity`} {...register(`slots.${index}.quantity`, { valueAsNumber: true })} />
        <Button type="button" size="icon" variant="ghost" aria-label={`Remove slot ${index + 1}`} disabled={!canRemove} onClick={remove}><Trash2 /></Button>
      </div>
      <p className="text-xs text-muted-foreground">One choice makes a fixed bundle. Several choices let the customer pick (e.g. any soft drink).</p>
      {options.fields.map((f, j) => (
        <div key={f.id} className="grid items-center gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Controller control={control} name={`slots.${index}.options.${j}.variantId`} render={({ field }) => <SimpleSelect value={field.value} onChange={field.onChange} options={variantOptions} placeholder="Choose an item" label={`Slot ${index + 1} choice ${j + 1}`} />} />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="radio" className="accent-[var(--primary)]" name={`default-${index}`} checked={!!values?.[j]?.isDefault} onChange={() => onChangeDefault(index, j)} /> Default</label>
          <Button type="button" size="icon" variant="ghost" aria-label={`Remove choice ${j + 1}`} disabled={options.fields.length === 1} onClick={() => options.remove(j)}><Trash2 /></Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => options.append({ variantId: "", isDefault: false })}><Plus /> Add choice</Button>
    </div>
  );
}

function ComboSheet({ combo, onClose }: { combo: Combo | "new"; onClose: () => void }) {
  const isNew = combo === "new";
  const defaultBrand = useDefaultBrandId();
  const brands = useBrands();
  const invalidate = useInvalidate();
  const taxCategories = useAll<{ id: string; name: string }>("/tax-categories");
  const [current, setCurrent] = useState<Combo | null>(isNew ? null : combo);

  const { register, control, handleSubmit, setValue, watch, setError, reset, getValues, formState: { errors } } = useForm<FormValues>({
    resolver: ((values: FormValues, ctx: unknown, opts: unknown) => (zodResolver(comboInputSchema as never) as never as (v: unknown, c: unknown, o: unknown) => unknown)(clean(values), ctx, opts)) as never,
    defaultValues: isNew ? blank(defaultBrand) : toForm(combo),
  });
  const slots = useFieldArray({ control, name: "slots" });
  const brandId = watch("brandId");
  useEffect(() => { if (isNew && !brandId && defaultBrand) setValue("brandId", defaultBrand); }, [isNew, brandId, defaultBrand, setValue]);

  const products = useAll<{ id: string; name: string; variants: { id: string; name: string }[] }>("/products", { brandId }, !!brandId);
  const variantOptions = useMemo(() => (products.data ?? []).flatMap((p) => p.variants.map((v) => ({ value: v.id, label: p.variants.length > 1 ? `${p.name} (${v.name})` : p.name }))), [products.data]);

  const setDefault = (slot: number, option: number) => {
    const n = getValues(`slots.${slot}.options`).length;
    for (let k = 0; k < n; k++) setValue(`slots.${slot}.options.${k}.isDefault`, k === option);
  };

  const save = useMutation({
    mutationFn: async (v: FormValues) => (current ? (await api.patch<{ data: Combo }>(`/combos/${current.id}`, clean(v))).data : (await api.post<{ data: Combo }>("/combos", clean(v))).data),
    onSuccess: async (saved) => { toast.success(current ? "Combo saved" : "Combo created. Now set its price below."); await invalidate("/combos"); setCurrent(saved); reset(toForm(saved)); },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422) { const entries = Object.entries(e.fieldErrors); for (const [f, m] of entries) setError(f.split(".")[0] as keyof FormValues, { message: m[0] }); if (!entries.length) toast.error(e.message); } else toast.error(errorMessage(e));
    },
  });
  const err = (k: keyof FormValues) => (errors[k]?.message as string | undefined) ?? undefined;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader><SheetTitle>{current ? current.name : "New combo"}</SheetTitle><SheetDescription>A bundle sold at one price, such as a burger, fries and a drink.</SheetDescription></SheetHeader>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-5 px-4 pb-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand" error={err("brandId")}><SimpleSelect value={brandId} onChange={(v) => setValue("brandId", v)} options={(brands.data ?? []).map((b) => ({ value: b.id, label: b.name }))} disabled={!isNew} placeholder="Choose a brand" label="Brand" /></Field>
            <Field label="Name" error={err("name")}><Input {...register("name")} aria-label="Name" /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea rows={2} {...register("description")} aria-label="Description" /></Field>
            <Field label="Image URL" error={err("imageUrl")}><Input placeholder="https://…" {...register("imageUrl")} aria-label="Image URL" /></Field>
            <Field label="Tax category" error={err("taxCategoryId")}><Controller control={control} name="taxCategoryId" render={({ field }) => <SimpleSelect allowEmpty value={field.value} onChange={field.onChange} options={(taxCategories.data ?? []).map((t) => ({ value: t.id, label: t.name }))} placeholder="Default" label="Tax category" />} /></Field>
            <Field label="Starts (optional)" hint="Leave both empty to run all the time."><Input type="datetime-local" {...register("startsAt")} aria-label="Starts" /></Field>
            <Field label="Ends (optional)" error={err("endsAt")}><Input type="datetime-local" {...register("endsAt")} aria-label="Ends" /></Field>
            <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm sm:col-span-2"><span>Active</span><Controller control={control} name="isActive" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Active" />} /></label>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">What is in the combo</h3><Button type="button" size="sm" variant="outline" onClick={() => slots.append({ name: "", quantity: 1, options: [{ variantId: "", isDefault: true }] })}><Plus /> Add slot</Button></div>
            {slots.fields.map((f, i) => <SlotEditor key={f.id} index={i} control={control} register={register} remove={() => slots.remove(i)} canRemove={slots.fields.length > 1} variantOptions={variantOptions} onChangeDefault={setDefault} />)}
            {typeof errors.slots?.message === "string" && <p className="text-xs text-destructive">{errors.slots.message}</p>}
          </section>

          <Can permission="menu.manage"><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : current ? "Save changes" : "Create combo"}</Button></Can>
        </form>

        <div className="space-y-3 border-t px-4 py-4">
          <h3 className="text-sm font-semibold">Prices</h3>
          {current ? (
            <>
              <PriceEditor targetKey="comboId" targetId={current.id} brandId={current.brandId} title={`${current.name} (bundle price)`} withCompareAt />
              {current.slots.filter((s) => s.options.length > 1).flatMap((s) => s.options.map((o) => <PriceEditor key={o.id} targetKey="comboSlotOptionId" targetId={o.id} brandId={current.brandId} title={`${s.name}: ${o.variant.product.name} (${o.variant.name}) up-charge`} />))}
            </>
          ) : <p className="text-sm text-muted-foreground">Save the combo first, then set its price.</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function CombosPage() {
  const { exponent } = useCurrencies();
  const { brandId } = useScope();
  const { state, update } = useTableState("name");
  const [showArchived, setShowArchived] = useState(false);
  const list = useList<Combo>("/combos", state, { ...(brandId ? { brandId } : {}), ...(showArchived ? { includeArchived: true } : {}) });
  const invalidate = useInvalidate();
  const [sheet, setSheet] = useState<Combo | "new" | null>(null);
  const [toArchive, setToArchive] = useState<Combo | null>(null);
  const archive = useMutation({ mutationFn: (c: Combo) => api.del(`/combos/${c.id}`), onSuccess: async () => { toast.success("Combo archived"); setToArchive(null); await invalidate("/combos"); }, onError: (e) => toast.error(errorMessage(e)) });
  const restore = useMutation({ mutationFn: (c: Combo) => api.post(`/combos/${c.id}/restore`), onSuccess: async () => { toast.success("Combo restored"); await invalidate("/combos"); }, onError: (e) => toast.error(errorMessage(e)) });

  const columns: ColumnDef<Combo, any>[] = [
    { accessorKey: "name", header: "Combo", meta: { sortKey: "name", label: "Combo" }, cell: ({ row }) => <div><div className="font-medium">{row.original.name}</div><div className="max-w-sm truncate text-xs text-muted-foreground">{row.original.slots.map((s) => `${s.quantity > 1 ? `${s.quantity}× ` : ""}${s.name}`).join(" + ")}</div></div> },
    { id: "price", header: "Price", meta: { label: "Price" }, cell: ({ row }) => { const r = row.original.priceRange; return r ? <span className="tabular-nums">{formatMinor(r.minMinor, r.currencyCode, exponent(r.currencyCode))}{r.minMinor !== r.maxMinor && " +"}</span> : <span className="text-xs text-amber-600 dark:text-amber-400">No price yet</span>; } },
    { id: "window", header: "Runs", meta: { label: "Runs" }, cell: ({ row }) => (row.original.startsAt || row.original.endsAt ? <span className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(row.original.startsAt)} to {fmtDate(row.original.endsAt)}</span> : <span className="text-sm text-muted-foreground">Always</span>) },
    { accessorKey: "isActive", header: "Status", cell: ({ row }) => (row.original.deletedAt ? <Badge variant="secondary">Archived</Badge> : <ActiveBadge active={row.original.isActive} />) },
    { id: "actions", header: "", meta: { className: "w-24 text-right" }, cell: ({ row }) => <Can permission="menu.manage"><div className="flex justify-end" onClick={(e) => e.stopPropagation()}>{row.original.deletedAt ? <Button size="sm" variant="ghost" onClick={() => restore.mutate(row.original)}><Undo2 /> Restore</Button> : <Button size="icon" variant="ghost" aria-label={`Archive ${row.original.name}`} onClick={() => setToArchive(row.original)}><Archive /></Button>}</div></Can> },
  ];

  return (
    <>
      <PageHeader title="Combos & deals" description="Bundles sold at one price, optionally for a limited time." actions={<Can permission="menu.manage"><Button onClick={() => setSheet("new")}><Plus /> New combo</Button></Can>} />
      <DataTable columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update} loading={list.isFetching} error={list.isError ? errorMessage(list.error) : null} onRetry={() => list.refetch()} exportName="combos" getRowId={(r) => r.id} onRowClick={(r) => setSheet(r)}
        emptyTitle="No combos yet" emptyDescription="Bundle products into a deal, such as a burger, fries and a drink." filters={<label className="flex items-center gap-2 text-sm text-muted-foreground"><Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Show archived" /> Show archived</label>} />
      {sheet && <ComboSheet key={sheet === "new" ? "new" : sheet.id} combo={sheet} onClose={() => setSheet(null)} />}
      <ConfirmDialog open={!!toArchive} onOpenChange={(o) => !o && setToArchive(null)} title={`Archive ${toArchive?.name}?`} description="It stops being sold. You can restore it later." confirmLabel="Archive" destructive busy={archive.isPending} onConfirm={() => toArchive && archive.mutate(toArchive)} />
    </>
  );
}
