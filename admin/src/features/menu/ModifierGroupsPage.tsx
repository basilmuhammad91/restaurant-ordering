import { zodResolver } from "@hookform/resolvers/zod";
import { modifierGroupInputSchema } from "@restoflux/contracts";
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Plus, Trash2, Undo2 } from "lucide-react";
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
import { useInvalidate, useList } from "@/lib/queries";
import { useScope } from "@/lib/scope";
import { Field, PriceEditor, SimpleSelect, useBrands, useDefaultBrandId } from "./shared";

interface Option { id: string; name: string; isDefault: boolean; sortOrder: number }
interface Group { id: string; brandId: string; name: string; minSelect: number; maxSelect: number; isActive: boolean; deletedAt: string | null; options: Option[]; _count: { products: number } }

interface FormValues { brandId: string; name: string; minSelect: number; maxSelect: number; isActive: boolean; options: { id?: string; name: string; isDefault: boolean }[] }
const blank = (brandId: string): FormValues => ({ brandId, name: "", minSelect: 0, maxSelect: 1, isActive: true, options: [{ name: "", isDefault: false }] });
const toForm = (g: Group): FormValues => ({ brandId: g.brandId, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, isActive: g.isActive, options: g.options.map((o) => ({ id: o.id, name: o.name, isDefault: o.isDefault })) });

function GroupSheet({ group, onClose }: { group: Group | "new"; onClose: () => void }) {
  const isNew = group === "new";
  const defaultBrand = useDefaultBrandId();
  const brands = useBrands();
  const invalidate = useInvalidate();
  const [current, setCurrent] = useState<Group | null>(isNew ? null : group);
  const { register, control, handleSubmit, setValue, watch, setError, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(modifierGroupInputSchema as never) as never, defaultValues: isNew ? blank(defaultBrand) : toForm(group),
  });
  const options = useFieldArray({ control, name: "options" });
  const brandId = watch("brandId");
  useEffect(() => { if (isNew && !brandId && defaultBrand) setValue("brandId", defaultBrand); }, [isNew, brandId, defaultBrand, setValue]);

  const save = useMutation({
    mutationFn: async (v: FormValues) => (current ? (await api.patch<{ data: Group }>(`/modifier-groups/${current.id}`, v)).data : (await api.post<{ data: Group }>("/modifier-groups", v)).data),
    onSuccess: async (saved) => { toast.success(current ? "Group saved" : "Group created. You can now set add-on prices below."); await invalidate("/modifier-groups"); setCurrent(saved); reset(toForm(saved)); },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422) { const entries = Object.entries(e.fieldErrors); for (const [f, m] of entries) setError(f.split(".")[0] as keyof FormValues, { message: m[0] }); if (!entries.length) toast.error(e.message); } else toast.error(errorMessage(e));
    },
  });
  const err = (k: keyof FormValues) => (errors[k]?.message as string | undefined) ?? undefined;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader><SheetTitle>{current ? current.name : "New modifier group"}</SheetTitle><SheetDescription>A set of choices a customer can add to a product: extras, sauces, how well done.</SheetDescription></SheetHeader>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-5 px-4 pb-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand" error={err("brandId")}><SimpleSelect value={brandId} onChange={(v) => setValue("brandId", v)} options={(brands.data ?? []).map((b) => ({ value: b.id, label: b.name }))} disabled={!isNew} placeholder="Choose a brand" label="Brand" /></Field>
            <Field label="Group name" error={err("name")}><Input placeholder="Extras" {...register("name")} aria-label="Group name" /></Field>
            <Field label="Minimum choices" hint="0 = optional. 1 or more = the customer must choose." error={err("minSelect")}><Input type="number" min={0} {...register("minSelect", { valueAsNumber: true })} aria-label="Minimum choices" /></Field>
            <Field label="Maximum choices" error={err("maxSelect")}><Input type="number" min={1} {...register("maxSelect", { valueAsNumber: true })} aria-label="Maximum choices" /></Field>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Options</h3><Button type="button" size="sm" variant="outline" onClick={() => options.append({ name: "", isDefault: false })}><Plus /> Add option</Button></div>
            {options.fields.map((f, i) => (
              <div key={f.id} className="grid items-center gap-2 sm:grid-cols-[1fr_auto_auto]">
                <Input placeholder="Option name" aria-label={`Option ${i + 1} name`} {...register(`options.${i}.name`)} />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" className="accent-[var(--primary)]" {...register(`options.${i}.isDefault`)} /> Preselected</label>
                <Button type="button" size="icon" variant="ghost" aria-label={`Remove option ${i + 1}`} disabled={options.fields.length === 1} onClick={() => options.remove(i)}><Trash2 /></Button>
              </div>
            ))}
            {typeof errors.options?.message === "string" && <p className="text-xs text-destructive">{errors.options.message}</p>}
          </section>

          <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"><span>Active</span><Controller control={control} name="isActive" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Active" />} /></label>
          <Can permission="menu.manage"><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : current ? "Save changes" : "Create group"}</Button></Can>
        </form>

        <div className="space-y-3 border-t px-4 py-4">
          <h3 className="text-sm font-semibold">Add-on prices</h3>
          <p className="text-xs text-muted-foreground">What each option adds to the price. An option with no price is free.</p>
          {current ? current.options.map((o) => <PriceEditor key={o.id} targetKey="modifierOptionId" targetId={o.id} brandId={current.brandId} title={o.name} />) : <p className="text-sm text-muted-foreground">Save the group first, then set the price of each option.</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function ModifierGroupsPage() {
  const { brandId } = useScope();
  const { state, update } = useTableState("name");
  const [showArchived, setShowArchived] = useState(false);
  const list = useList<Group>("/modifier-groups", state, { ...(brandId ? { brandId } : {}), ...(showArchived ? { includeArchived: true } : {}) });
  const invalidate = useInvalidate();
  const [sheet, setSheet] = useState<Group | "new" | null>(null);
  const [toArchive, setToArchive] = useState<Group | null>(null);
  const archive = useMutation({ mutationFn: (g: Group) => api.del(`/modifier-groups/${g.id}`), onSuccess: async () => { toast.success("Group archived"); setToArchive(null); await invalidate("/modifier-groups"); }, onError: (e) => toast.error(errorMessage(e)) });
  const restore = useMutation({ mutationFn: (g: Group) => api.post(`/modifier-groups/${g.id}/restore`), onSuccess: async () => { toast.success("Group restored"); await invalidate("/modifier-groups"); }, onError: (e) => toast.error(errorMessage(e)) });

  const columns: ColumnDef<Group, any>[] = [
    { accessorKey: "name", header: "Group", meta: { sortKey: "name", label: "Group" }, cell: ({ row }) => <div><div className="font-medium">{row.original.name}</div><div className="max-w-xs truncate text-xs text-muted-foreground">{row.original.options.map((o) => o.name).join(", ")}</div></div> },
    { id: "rule", header: "Choices", meta: { label: "Choices" }, cell: ({ row }) => (row.original.minSelect > 0 ? <Badge variant="secondary">Required: pick {row.original.minSelect === row.original.maxSelect ? row.original.minSelect : `${row.original.minSelect}-${row.original.maxSelect}`}</Badge> : <span className="text-sm text-muted-foreground">Optional, up to {row.original.maxSelect}</span>) },
    { id: "products", header: "Used on", meta: { label: "Products" }, cell: ({ row }) => `${row.original._count.products} product${row.original._count.products === 1 ? "" : "s"}` },
    { accessorKey: "isActive", header: "Status", cell: ({ row }) => (row.original.deletedAt ? <Badge variant="secondary">Archived</Badge> : <ActiveBadge active={row.original.isActive} />) },
    { id: "actions", header: "", meta: { className: "w-24 text-right" }, cell: ({ row }) => (
      <Can permission="menu.manage"><div className="flex justify-end" onClick={(e) => e.stopPropagation()}>{row.original.deletedAt ? <Button size="sm" variant="ghost" onClick={() => restore.mutate(row.original)}><Undo2 /> Restore</Button> : <Button size="icon" variant="ghost" aria-label={`Archive ${row.original.name}`} onClick={() => setToArchive(row.original)}><Archive /></Button>}</div></Can>
    ) },
  ];

  return (
    <>
      <PageHeader title="Modifier groups" description="Extras, sauces and choices customers can add. Attach a group to as many products as you like." actions={<Can permission="menu.manage"><Button onClick={() => setSheet("new")}><Plus /> New group</Button></Can>} />
      <DataTable columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update} loading={list.isFetching} error={list.isError ? errorMessage(list.error) : null} onRetry={() => list.refetch()} exportName="modifier-groups" getRowId={(r) => r.id} onRowClick={(r) => setSheet(r)}
        emptyTitle="No modifier groups yet" emptyDescription="Create one for extras like cheese or bacon, then attach it to products." filters={<label className="flex items-center gap-2 text-sm text-muted-foreground"><Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Show archived" /> Show archived</label>} />
      {sheet && <GroupSheet key={sheet === "new" ? "new" : sheet.id} group={sheet} onClose={() => setSheet(null)} />}
      <ConfirmDialog open={!!toArchive} onOpenChange={(o) => !o && setToArchive(null)} title={`Archive ${toArchive?.name}?`} description="Products stop offering these choices. You can restore it later." confirmLabel="Archive" destructive busy={archive.isPending} onConfirm={() => toArchive && archive.mutate(toArchive)} />
    </>
  );
}
