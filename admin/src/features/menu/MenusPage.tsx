import { zodResolver } from "@hookform/resolvers/zod";
import { menuInputSchema } from "@restoflux/contracts";
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Clock, Plus, Trash2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Can } from "@/components/Can";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ActiveBadge } from "@/components/cells";
import { DataTable } from "@/components/data-table/DataTable";
import { useTableState } from "@/components/data-table/useTableState";
import { PageHeader } from "@/components/page/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAll, useInvalidate, useList } from "@/lib/queries";
import { useScope } from "@/lib/scope";
import { ChipPicker, Field, ItemPicker, SimpleSelect, useBrands, useDefaultBrandId } from "./shared";

interface Schedule { id: string; weekdays: number[]; startsAt: string | null; endsAt: string | null }
interface Menu { id: string; brandId: string; name: string; isDefault: boolean; isActive: boolean; deletedAt: string | null; schedules: Schedule[]; productIds: string[]; comboIds: string[] }

// Monday first, as most kitchens think of the week. Values follow JavaScript: 0 = Sunday.
const DAYS = [{ value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" }, { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 0, label: "Sun" }];
const dayNames = (days: number[]) => (days.length === 7 ? "Every day" : DAYS.filter((d) => days.includes(d.value)).map((d) => d.label).join(", "));
export const describeSchedule = (s: Pick<Schedule, "weekdays" | "startsAt" | "endsAt">) => `${dayNames(s.weekdays)}, ${s.startsAt && s.endsAt ? `${s.startsAt} to ${s.endsAt}` : "all day"}`;

interface FormValues { brandId: string; name: string; isDefault: boolean; isActive: boolean; schedules: { weekdays: number[]; allDay: boolean; startsAt: string; endsAt: string }[]; productIds: string[]; comboIds: string[] }
const blank = (brandId: string): FormValues => ({ brandId, name: "", isDefault: false, isActive: true, schedules: [{ weekdays: [1, 2, 3, 4, 5], allDay: false, startsAt: "11:00", endsAt: "16:00" }], productIds: [], comboIds: [] });
const toForm = (m: Menu): FormValues => ({
  brandId: m.brandId, name: m.name, isDefault: m.isDefault, isActive: m.isActive, productIds: m.productIds, comboIds: m.comboIds,
  schedules: m.schedules.map((s) => ({ weekdays: s.weekdays, allDay: s.startsAt === null, startsAt: s.startsAt ?? "09:00", endsAt: s.endsAt ?? "17:00" })),
});
const toBody = (v: FormValues) => ({ ...v, schedules: v.schedules.map((s) => ({ weekdays: s.weekdays, startsAt: s.allDay ? null : s.startsAt, endsAt: s.allDay ? null : s.endsAt })) });

function MenuSheet({ menu, onClose }: { menu: Menu | "new"; onClose: () => void }) {
  const isNew = menu === "new";
  const defaultBrand = useDefaultBrandId();
  const brands = useBrands();
  const invalidate = useInvalidate();
  const [current, setCurrent] = useState<Menu | null>(isNew ? null : menu);
  const { register, control, handleSubmit, setValue, watch, setError, reset, formState: { errors } } = useForm<FormValues>({
    resolver: ((values: FormValues, ctx: unknown, opts: unknown) => (zodResolver(menuInputSchema as never) as never as (v: unknown, c: unknown, o: unknown) => unknown)(toBody(values), ctx, opts)) as never,
    defaultValues: isNew ? blank(defaultBrand) : toForm(menu),
  });
  const schedules = useFieldArray({ control, name: "schedules" });
  const brandId = watch("brandId");
  useEffect(() => { if (isNew && !brandId && defaultBrand) setValue("brandId", defaultBrand); }, [isNew, brandId, defaultBrand, setValue]);
  const products = useAll<{ id: string; name: string; category: { name: string } }>("/products", { brandId }, !!brandId);
  const combos = useAll<{ id: string; name: string }>("/combos", { brandId }, !!brandId);

  const save = useMutation({
    mutationFn: async (v: FormValues) => (current ? (await api.patch<{ data: Menu }>(`/menus/${current.id}`, toBody(v))).data : (await api.post<{ data: Menu }>("/menus", toBody(v))).data),
    onSuccess: async (saved) => { toast.success(current ? "Menu saved" : "Menu created"); await invalidate("/menus"); setCurrent(saved); reset(toForm(saved)); if (!current) onClose(); },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422) { const entries = Object.entries(e.fieldErrors); for (const [f, m] of entries) setError(f.split(".")[0] as keyof FormValues, { message: m[0] }); if (!entries.length) toast.error(e.message); } else toast.error(errorMessage(e));
    },
  });
  const err = (k: keyof FormValues) => (errors[k]?.message as string | undefined) ?? undefined;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader><SheetTitle>{current ? current.name : "New menu"}</SheetTitle><SheetDescription>Choose what is sold, and when. Times follow each branch's own clock.</SheetDescription></SheetHeader>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-5 px-4 pb-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand" error={err("brandId")}><SimpleSelect value={brandId} onChange={(v) => { setValue("brandId", v); setValue("productIds", []); setValue("comboIds", []); }} options={(brands.data ?? []).map((b) => ({ value: b.id, label: b.name }))} disabled={!isNew} placeholder="Choose a brand" label="Brand" /></Field>
            <Field label="Menu name" error={err("name")}><Input placeholder="Lunch" {...register("name")} aria-label="Menu name" /></Field>
            <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"><span>Default menu <span className="block text-xs text-muted-foreground">Served whenever it has no schedule. One per brand.</span></span><Controller control={control} name="isDefault" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Default menu" />} /></label>
            <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"><span>Active</span><Controller control={control} name="isActive" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Active" />} /></label>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">When it is served</h3><Button type="button" size="sm" variant="outline" onClick={() => schedules.append({ weekdays: [1, 2, 3, 4, 5], allDay: false, startsAt: "11:00", endsAt: "16:00" })}><Plus /> Add time</Button></div>
            <p className="text-xs text-muted-foreground">A window that ends before it starts runs past midnight (22:00 to 02:00 belongs to the day it started).</p>
            {schedules.fields.length === 0 && <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">No times set: this menu is only served if it is the default menu.</p>}
            {schedules.fields.map((f, i) => (
              <div key={f.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <Controller control={control} name={`schedules.${i}.weekdays`} render={({ field }) => <ChipPicker label={`Days for time ${i + 1}`} value={field.value} onChange={field.onChange} options={DAYS} />} />
                  <Button type="button" size="icon" variant="ghost" aria-label={`Remove time ${i + 1}`} onClick={() => schedules.remove(i)}><Trash2 /></Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm"><Controller control={control} name={`schedules.${i}.allDay`} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="All day" />} /> All day</label>
                  {!watch(`schedules.${i}.allDay`) && (
                    <>
                      <Input type="time" className="w-32" aria-label={`Time ${i + 1} from`} {...register(`schedules.${i}.startsAt`)} />
                      <span className="text-sm text-muted-foreground">to</span>
                      <Input type="time" className="w-32" aria-label={`Time ${i + 1} to`} {...register(`schedules.${i}.endsAt`)} />
                    </>
                  )}
                </div>
              </div>
            ))}
            {typeof errors.schedules?.message === "string" && <p className="text-xs text-destructive">{errors.schedules.message}</p>}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Products on this menu</h3>
            <p className="text-xs text-muted-foreground">Once a brand has menus, only products listed on a menu being served right now are sold.</p>
            <Controller control={control} name="productIds" render={({ field }) => <ItemPicker label="products" items={(products.data ?? []).map((p) => ({ id: p.id, name: p.name, hint: p.category.name }))} selected={field.value} onChange={field.onChange} empty="This brand has no products yet." />} />
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Combos on this menu</h3>
            <Controller control={control} name="comboIds" render={({ field }) => <ItemPicker label="combos" items={(combos.data ?? []).map((c) => ({ id: c.id, name: c.name }))} selected={field.value} onChange={field.onChange} empty="This brand has no combos yet." />} />
          </section>

          <Can permission="menu.manage"><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : current ? "Save changes" : "Create menu"}</Button></Can>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export default function MenusPage() {
  const { brandId } = useScope();
  const { state, update } = useTableState("name");
  const [showArchived, setShowArchived] = useState(false);
  const list = useList<Menu>("/menus", state, { ...(brandId ? { brandId } : {}), ...(showArchived ? { includeArchived: true } : {}) });
  const invalidate = useInvalidate();
  const [sheet, setSheet] = useState<Menu | "new" | null>(null);
  const [toArchive, setToArchive] = useState<Menu | null>(null);
  const archive = useMutation({ mutationFn: (m: Menu) => api.del(`/menus/${m.id}`), onSuccess: async () => { toast.success("Menu archived"); setToArchive(null); await invalidate("/menus"); }, onError: (e) => toast.error(errorMessage(e)) });
  const restore = useMutation({ mutationFn: (m: Menu) => api.post(`/menus/${m.id}/restore`), onSuccess: async () => { toast.success("Menu restored"); await invalidate("/menus"); }, onError: (e) => toast.error(errorMessage(e)) });

  const columns: ColumnDef<Menu, any>[] = [
    { accessorKey: "name", header: "Menu", meta: { sortKey: "name", label: "Menu" }, cell: ({ row }) => <div className="flex items-center gap-2"><span className="font-medium">{row.original.name}</span>{row.original.isDefault && <Badge variant="secondary">Default</Badge>}</div> },
    { id: "when", header: "Served", meta: { label: "Served" }, cell: ({ row }) => (row.original.schedules.length ? <div className="space-y-0.5 text-sm text-muted-foreground">{row.original.schedules.map((s) => <div key={s.id} className="flex items-center gap-1"><Clock className="size-3" /> {describeSchedule(s)}</div>)}</div> : <span className="text-sm text-muted-foreground">{row.original.isDefault ? "Always (default)" : "Never (no times set)"}</span>) },
    { id: "items", header: "Items", meta: { label: "Items" }, cell: ({ row }) => `${row.original.productIds.length} products, ${row.original.comboIds.length} combos` },
    { accessorKey: "isActive", header: "Status", cell: ({ row }) => (row.original.deletedAt ? <Badge variant="secondary">Archived</Badge> : <ActiveBadge active={row.original.isActive} />) },
    { id: "actions", header: "", meta: { className: "w-24 text-right" }, cell: ({ row }) => <Can permission="menu.manage"><div className="flex justify-end" onClick={(e) => e.stopPropagation()}>{row.original.deletedAt ? <Button size="sm" variant="ghost" onClick={() => restore.mutate(row.original)}><Undo2 /> Restore</Button> : <Button size="icon" variant="ghost" aria-label={`Archive ${row.original.name}`} onClick={() => setToArchive(row.original)}><Archive /></Button>}</div></Can> },
  ];

  return (
    <>
      <PageHeader title="Menus & dayparts" description="Serve breakfast, lunch and dinner menus at the right hours. Without any menu, every priced product is sold all day." actions={<Can permission="menu.manage"><Button onClick={() => setSheet("new")}><Plus /> New menu</Button></Can>} />
      <DataTable columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update} loading={list.isFetching} error={list.isError ? errorMessage(list.error) : null} onRetry={() => list.refetch()} exportName="menus" getRowId={(r) => r.id} onRowClick={(r) => setSheet(r)}
        emptyTitle="No menus yet" emptyDescription="You do not need one unless you serve different food at different times." filters={<label className="flex items-center gap-2 text-sm text-muted-foreground"><Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Show archived" /> Show archived</label>} />
      {sheet && <MenuSheet key={sheet === "new" ? "new" : sheet.id} menu={sheet} onClose={() => setSheet(null)} />}
      <ConfirmDialog open={!!toArchive} onOpenChange={(o) => !o && setToArchive(null)} title={`Archive ${toArchive?.name}?`} description="Its items are no longer served through it. You can restore it later." confirmLabel="Archive" destructive busy={archive.isPending} onConfirm={() => toArchive && archive.mutate(toArchive)} />
    </>
  );
}
