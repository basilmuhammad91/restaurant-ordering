import { zodResolver } from "@hookform/resolvers/zod";
import { ALLERGENS, PRODUCT_TAGS, productInputSchema } from "@restoflux/contracts";
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ImageOff, Plus, Trash2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useFieldArray, useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { Can } from "@/components/Can";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { titleCase } from "@/components/cells";
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
import { ChipPicker, Field, ItemPicker, PriceEditor, SimpleSelect, useBrands, useDefaultBrandId } from "./shared";

interface Variant { id: string; name: string; sku: string | null; isDefault: boolean; sortOrder: number }
interface Product {
  id: string; brandId: string; categoryId: string; name: string; description: string | null; imageUrl: string | null; sku: string | null;
  taxCategoryId: string | null; stationKey: string | null; tags: string[]; allergens: string[]; isActive: boolean; sortOrder: number; deletedAt: string | null;
  category: { id: string; name: string }; variants: Variant[];
  modifiers: { modifierGroupId: string; sortOrder: number; minSelectOverride: number | null; maxSelectOverride: number | null }[];
  priceRange: { minMinor: number; maxMinor: number; currencyCode: string } | null;
}

interface FormValues {
  brandId: string; categoryId: string; name: string; description: string; imageUrl: string; sku: string; taxCategoryId: string; stationKey: string;
  tags: string[]; allergens: string[]; isActive: boolean;
  variants: { id?: string; name: string; sku: string; isDefault: boolean }[];
  modifierGroups: { modifierGroupId: string; sortOrder: number }[];
}

const blank = (brandId: string): FormValues => ({
  brandId, categoryId: "", name: "", description: "", imageUrl: "", sku: "", taxCategoryId: "", stationKey: "", tags: [], allergens: [], isActive: true,
  variants: [{ name: "Regular", sku: "", isDefault: true }], modifierGroups: [],
});
const toForm = (p: Product): FormValues => ({
  brandId: p.brandId, categoryId: p.categoryId, name: p.name, description: p.description ?? "", imageUrl: p.imageUrl ?? "", sku: p.sku ?? "", taxCategoryId: p.taxCategoryId ?? "", stationKey: p.stationKey ?? "",
  tags: p.tags, allergens: p.allergens, isActive: p.isActive,
  variants: p.variants.map((v) => ({ id: v.id, name: v.name, sku: v.sku ?? "", isDefault: v.isDefault })),
  modifierGroups: p.modifiers.map((m, i) => ({ modifierGroupId: m.modifierGroupId, sortOrder: i })),
});

/** Empty text boxes mean "no value", which the API wants as null. */
const clean = (v: FormValues) => ({
  ...v,
  description: v.description.trim() || null, imageUrl: v.imageUrl.trim() || null, sku: v.sku.trim() || null,
  taxCategoryId: v.taxCategoryId || null, stationKey: v.stationKey.trim() || null,
  variants: v.variants.map((x) => ({ ...x, sku: x.sku.trim() || null })),
});
const resolver: Resolver<FormValues> = ((values: FormValues, ctx: unknown, opts: unknown) => (zodResolver(productInputSchema as never) as never as (v: unknown, c: unknown, o: unknown) => unknown)(clean(values), ctx, opts)) as never;

const columns = (exp: (c: string) => number): ColumnDef<Product, any>[] => [
  {
    accessorKey: "name", header: "Product", meta: { sortKey: "name", label: "Product" },
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground">
          {row.original.imageUrl ? <img src={row.original.imageUrl} alt="" className="size-full object-cover" /> : <ImageOff className="size-4" />}
        </div>
        <div className="min-w-0">
          <div className="truncate font-medium">{row.original.name}</div>
          <div className="truncate text-xs text-muted-foreground">{row.original.variants.map((v) => v.name).join(" · ")}</div>
        </div>
      </div>
    ),
  },
  { id: "category", header: "Category", meta: { label: "Category" }, accessorFn: (r) => r.category.name },
  {
    id: "price", header: "Price", meta: { label: "Price" },
    cell: ({ row }) => {
      const r = row.original.priceRange;
      if (!r) return <span className="text-xs text-amber-600 dark:text-amber-400">No price yet</span>;
      const f = (n: number) => formatMinor(n, r.currencyCode, exp(r.currencyCode));
      return <span className="whitespace-nowrap tabular-nums">{r.minMinor === r.maxMinor ? f(r.minMinor) : `${f(r.minMinor)} – ${f(r.maxMinor)}`}</span>;
    },
  },
  { id: "tags", header: "Indicators", meta: { label: "Indicators" }, cell: ({ row }) => <div className="flex flex-wrap gap-1">{row.original.tags.slice(0, 3).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{titleCase(t)}</Badge>)}</div> },
  {
    accessorKey: "isActive", header: "Status", meta: { label: "Status" },
    cell: ({ row }) => (row.original.deletedAt ? <Badge variant="secondary">Archived</Badge> : <Badge variant="secondary" className={row.original.isActive ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : ""}>{row.original.isActive ? "Active" : "Hidden"}</Badge>),
  },
];

function ProductSheet({ product, onClose, onSaved }: { product: Product | "new"; onClose: () => void; onSaved: (p: Product) => void }) {
  const isNew = product === "new";
  const defaultBrand = useDefaultBrandId();
  const brands = useBrands();
  const taxCategories = useAll<{ id: string; name: string }>("/tax-categories");
  const invalidate = useInvalidate();
  const [current, setCurrent] = useState<Product | null>(isNew ? null : product);

  const form = useForm<FormValues>({ resolver, defaultValues: isNew ? blank(defaultBrand) : toForm(product) });
  const { register, control, handleSubmit, setValue, watch, setError, reset, formState: { errors } } = form;
  const variants = useFieldArray({ control, name: "variants" });
  const brandId = watch("brandId");
  const categories = useAll<{ id: string; name: string }>("/categories", { brandId }, !!brandId);
  const groups = useAll<{ id: string; name: string; minSelect: number; maxSelect: number }>("/modifier-groups", { brandId }, !!brandId);

  useEffect(() => { if (isNew && !brandId && defaultBrand) setValue("brandId", defaultBrand); }, [isNew, brandId, defaultBrand, setValue]);

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const body = clean(v);
      return current ? (await api.patch<{ data: Product }>(`/products/${current.id}`, body)).data : (await api.post<{ data: Product }>("/products", body)).data;
    },
    onSuccess: async (saved) => {
      toast.success(current ? "Product saved" : "Product created. Now set its prices below.");
      await invalidate("/products");
      setCurrent(saved);
      reset(toForm(saved));
      onSaved(saved);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422) {
        const entries = Object.entries(e.fieldErrors);
        for (const [f, m] of entries) setError(f.split(".")[0] as keyof FormValues, { message: m[0] });
        if (!entries.length) toast.error(e.message);
      } else toast.error(errorMessage(e));
    },
  });

  const err = (k: keyof FormValues) => (errors[k]?.message as string | undefined) ?? undefined;
  const showCategoryHint = !!brandId && categories.data?.length === 0;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{current ? current.name : "New product"}</SheetTitle>
          <SheetDescription>{current ? "Edit the product, its sizes, add-ons and prices." : "Describe the product, then save to set its prices."}</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-5 px-4 pb-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand" error={err("brandId")}>
              <SimpleSelect value={brandId} onChange={(v) => { setValue("brandId", v); setValue("categoryId", ""); setValue("modifierGroups", []); }} options={(brands.data ?? []).map((b) => ({ value: b.id, label: b.name }))} disabled={!isNew} placeholder="Choose a brand" label="Brand" />
            </Field>
            <Field label="Category" error={err("categoryId")} hint={showCategoryHint ? "This brand has no categories yet: add one under Menu > Categories." : undefined}>
              <Controller control={control} name="categoryId" render={({ field }) => <SimpleSelect value={field.value} onChange={field.onChange} options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} placeholder="Choose a category" label="Category" />} />
            </Field>
            <Field label="Name" error={err("name")} className="sm:col-span-2"><Input {...register("name")} aria-label="Name" aria-invalid={!!errors.name} /></Field>
            <Field label="Description" error={err("description")} className="sm:col-span-2"><Textarea rows={2} {...register("description")} aria-label="Description" /></Field>
            <Field label="Image URL" error={err("imageUrl")} hint="A link to the photo shown on the POS and website."><Input placeholder="https://…" {...register("imageUrl")} aria-label="Image URL" /></Field>
            <Field label="SKU" error={err("sku")}><Input {...register("sku")} aria-label="SKU" /></Field>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Sizes and variants</h3>
              <Button type="button" size="sm" variant="outline" onClick={() => variants.append({ name: "", sku: "", isDefault: false })}><Plus /> Add size</Button>
            </div>
            <p className="text-xs text-muted-foreground">Every product has at least one. A plain item has just "Regular". Each size has its own price.</p>
            {variants.fields.map((f, i) => (
              <div key={f.id} className="grid items-center gap-2 sm:grid-cols-[1fr_9rem_auto_auto]">
                <Input placeholder="Size name" aria-label={`Size ${i + 1} name`} {...register(`variants.${i}.name`)} />
                <Input placeholder="SKU" aria-label={`Size ${i + 1} SKU`} {...register(`variants.${i}.sku`)} />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="radio" name="default-variant" className="accent-[var(--primary)]" checked={watch(`variants.${i}.isDefault`)} onChange={() => variants.fields.forEach((_, j) => setValue(`variants.${j}.isDefault`, j === i))} /> Default
                </label>
                <Button type="button" size="icon" variant="ghost" aria-label={`Remove size ${i + 1}`} disabled={variants.fields.length === 1} onClick={() => { const wasDefault = watch(`variants.${i}.isDefault`); variants.remove(i); if (wasDefault) setValue("variants.0.isDefault", true); }}><Trash2 /></Button>
              </div>
            ))}
            {typeof errors.variants?.message === "string" && <p className="text-xs text-destructive">{errors.variants.message}</p>}
            {errors.variants?.root?.message && <p className="text-xs text-destructive">{errors.variants.root.message}</p>}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Add-ons</h3>
            <p className="text-xs text-muted-foreground">Modifier groups customers can choose from, such as extras, sauces or doneness.</p>
            <Controller control={control} name="modifierGroups" render={({ field }) => (
              <ItemPicker label="modifier groups" items={(groups.data ?? []).map((g) => ({ id: g.id, name: g.name, hint: g.minSelect > 0 ? "required" : `up to ${g.maxSelect}` }))} selected={field.value.map((x) => x.modifierGroupId)} onChange={(ids) => field.onChange(ids.map((modifierGroupId, sortOrder) => ({ modifierGroupId, sortOrder })))} empty="No modifier groups for this brand yet." />
            )} />
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tax category" hint="Which tax rules apply (the branch's tax profile decides the rates)." error={err("taxCategoryId")}>
              <Controller control={control} name="taxCategoryId" render={({ field }) => <SimpleSelect allowEmpty value={field.value} onChange={field.onChange} options={(taxCategories.data ?? []).map((t) => ({ value: t.id, label: t.name }))} placeholder="Default" label="Tax category" />} />
            </Field>
            <Field label="Kitchen station" hint="Where the ticket prints: GRILL, FRY, BAR…" error={err("stationKey")}><Input placeholder="GRILL" className="uppercase" {...register("stationKey")} aria-label="Kitchen station" /></Field>
            <Field label="Indicators" className="sm:col-span-2">
              <Controller control={control} name="tags" render={({ field }) => <ChipPicker label="Indicators" value={field.value as never[]} onChange={field.onChange} options={PRODUCT_TAGS.map((t) => ({ value: t, label: titleCase(t) }))} />} />
            </Field>
            <Field label="Allergens" className="sm:col-span-2">
              <Controller control={control} name="allergens" render={({ field }) => <ChipPicker label="Allergens" value={field.value as never[]} onChange={field.onChange} options={ALLERGENS.map((t) => ({ value: t, label: titleCase(t) }))} />} />
            </Field>
            <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm sm:col-span-2">
              <span>Active <span className="text-xs text-muted-foreground">(hidden products are not sold anywhere)</span></span>
              <Controller control={control} name="isActive" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Active" />} />
            </label>
          </div>

          <Can permission="menu.manage"><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : current ? "Save changes" : "Create product"}</Button></Can>
        </form>

        <div className="space-y-3 border-t px-4 py-4">
          <h3 className="text-sm font-semibold">Prices</h3>
          {current ? current.variants.map((v) => <PriceEditor key={v.id} targetKey="variantId" targetId={v.id} brandId={current.brandId} title={current.variants.length > 1 ? `${current.name} (${v.name})` : current.name} />) : <p className="text-sm text-muted-foreground">Save the product first, then set its prices here.</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function ProductsPage() {
  const { exponent } = useCurrencies();
  const { brandId } = useScope();
  const { state, update } = useTableState("name", ["categoryId", "isActive"]);
  const [showArchived, setShowArchived] = useState(false);
  const categories = useAll<{ id: string; name: string }>("/categories", brandId ? { brandId } : {});
  const list = useList<Product>("/products", state, { ...(brandId ? { brandId } : {}), ...(showArchived ? { includeArchived: true } : {}) });
  const invalidate = useInvalidate();
  const [sheet, setSheet] = useState<Product | "new" | null>(null);
  const [toArchive, setToArchive] = useState<Product | null>(null);

  const archive = useMutation({
    mutationFn: (p: Product) => api.del(`/products/${p.id}`),
    onSuccess: async () => { toast.success("Product archived"); setToArchive(null); await invalidate("/products"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const restore = useMutation({
    mutationFn: (p: Product) => api.post(`/products/${p.id}/restore`),
    onSuccess: async () => { toast.success("Product restored"); await invalidate("/products"); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const cols: ColumnDef<Product, any>[] = [
    ...columns(exponent),
    {
      id: "actions", header: "", meta: { className: "w-24 text-right" },
      cell: ({ row }) => (
        <Can permission="menu.manage">
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            {row.original.deletedAt ? <Button size="sm" variant="ghost" onClick={() => restore.mutate(row.original)}><Undo2 /> Restore</Button> : <Button size="icon" variant="ghost" aria-label={`Archive ${row.original.name}`} onClick={() => setToArchive(row.original)}><Archive /></Button>}
          </div>
        </Can>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Products" description="Everything you sell. Each product has sizes, optional add-ons and a price per price book." actions={<Can permission="menu.manage"><Button onClick={() => setSheet("new")}><Plus /> New product</Button></Can>} />
      <DataTable
        columns={cols} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update}
        loading={list.isFetching} error={list.isError ? errorMessage(list.error) : null} onRetry={() => list.refetch()} exportName="products" getRowId={(r) => r.id}
        onRowClick={(r) => setSheet(r)} searchPlaceholder="Search name, SKU…"
        emptyTitle="No products yet" emptyDescription="Add a category first, then your first product." emptyAction={<Can permission="menu.manage"><Button onClick={() => setSheet("new")}><Plus /> New product</Button></Can>}
        filters={
          <>
            <SimpleSelect className="w-44" emptyLabel="All categories" value={state.filters.categoryId ?? ""} onChange={(v) => update({ filters: { categoryId: v || undefined } })} allowEmpty placeholder="All categories" options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} label="Category" />
            <SimpleSelect className="w-36" emptyLabel="Any status" value={state.filters.isActive ?? ""} onChange={(v) => update({ filters: { isActive: v || undefined } })} allowEmpty placeholder="Any status" options={[{ value: "true", label: "Active" }, { value: "false", label: "Hidden" }]} label="Status" />
            <label className="flex items-center gap-2 text-sm text-muted-foreground"><Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Show archived" /> Show archived</label>
          </>
        }
      />
      {sheet && <ProductSheet key={sheet === "new" ? "new" : sheet.id} product={sheet} onClose={() => setSheet(null)} onSaved={() => undefined} />}
      <ConfirmDialog open={!!toArchive} onOpenChange={(o) => !o && setToArchive(null)} title={`Archive ${toArchive?.name}?`} description="It disappears from the POS and website. Past orders keep it, and you can restore it any time." confirmLabel="Archive" destructive busy={archive.isPending} onConfirm={() => toArchive && archive.mutate(toArchive)} />
    </>
  );
}
