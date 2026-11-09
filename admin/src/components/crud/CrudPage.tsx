import { zodResolver } from "@hookform/resolvers/zod";
import type { PermissionKey } from "@restoflux/contracts";
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, MoreHorizontal, Pencil, Plus, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Can } from "@/components/Can";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataTable } from "@/components/data-table/DataTable";
import { useTableState } from "@/components/data-table/useTableState";
import { PageHeader } from "@/components/page/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useInvalidate, useList } from "@/lib/queries";
import { FieldControl, type FieldDef } from "./fields";

// The standard "list + create/edit in a side sheet + archive" page used by most master-data screens
// (brands, payment methods, tables, ...). A screen supplies configuration; this supplies the behaviour:
// URL-driven table, validation with the SAME Zod schemas the API uses, server errors shown on the right
// field, toasts, archive/restore with confirmation.

type Row = { id: string; deletedAt?: string | null };

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export interface CrudConfig<T extends Row> {
  title: string;
  description?: string;
  /** Singular noun for buttons and messages: "brand". */
  entity: string;
  /** API path of the collection: "/brands". */
  path: string;
  columns: ColumnDef<T, any>[];
  defaultSort: string;
  fields: FieldDef[];
  createSchema: z.ZodType;
  updateSchema: z.ZodType;
  /** Initial values for a new record. */
  defaults: Record<string, unknown>;
  /** Map an existing row to form values (default: the row itself). */
  toForm?: (row: T) => Record<string, unknown>;
  writePermission: PermissionKey;
  filters?: FilterDef[];
  searchPlaceholder?: string;
  /** Extra fixed query params for the list (e.g. a selected branch). */
  listParams?: Record<string, string | undefined>;
  /** Sections shown under the form while editing (hours editor, rules editor, credentials ...). */
  extraSections?: (row: T, close: () => void) => ReactNode;
  /** Extra items in each row's action menu. */
  rowActions?: (row: T) => ReactNode;
  /** Soft-deleted rows can be shown and restored (default true). */
  archivable?: boolean;
  /** true when DELETE removes the row for good (no archive/restore). */
  hardDelete?: boolean;
  emptyDescription?: ReactNode;
  wide?: boolean;
  /** Final adjustment of the payload before it is sent. */
  prepare?: (values: Record<string, unknown>, editing: boolean) => Record<string, unknown>;
  headerActions?: ReactNode;
  /** Inside a tab: no page header (the New button moves into the toolbar). */
  embedded?: boolean;
}

const NULLABLE_CLEAR = (fields: FieldDef[], values: Record<string, unknown>, editing: boolean) => {
  const out: Record<string, unknown> = { ...values };
  for (const f of fields) {
    if (f.mode === "create" && editing) delete out[f.name];
    if (f.mode === "edit" && !editing) delete out[f.name];
    const v = out[f.name];
    if (typeof v === "string") {
      const trimmed = v.trim();
      out[f.name] = trimmed === "" && f.nullable ? null : trimmed === "" && !f.required && !editing ? undefined : trimmed;
    }
    if (typeof v === "number" && Number.isNaN(v)) out[f.name] = undefined;
  }
  return out;
};

export function CrudPage<T extends Row>(cfg: CrudConfig<T>) {
  const { state, update } = useTableState(cfg.defaultSort, cfg.filters?.map((f) => f.key) ?? []);
  const [showArchived, setShowArchived] = useState(false);
  const archivable = cfg.archivable !== false && !cfg.hardDelete;
  const extra = { ...(cfg.listParams ?? {}), ...(showArchived ? { includeArchived: true } : {}) };
  const list = useList<T>(cfg.path, state, extra as Record<string, string | boolean | undefined>);
  const invalidate = useInvalidate();

  const [sheet, setSheet] = useState<{ mode: "create" } | { mode: "edit"; row: T } | null>(null);
  const [toArchive, setToArchive] = useState<T | null>(null);

  const archive = useMutation({
    mutationFn: (row: T) => api.del(`${cfg.path}/${row.id}`),
    onSuccess: async () => {
      toast.success(`${cap(cfg.entity)} ${cfg.hardDelete ? "deleted" : "archived"}`);
      setToArchive(null);
      await invalidate(cfg.path);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const restore = useMutation({
    mutationFn: (row: T) => api.post(`${cfg.path}/${row.id}/restore`),
    onSuccess: async () => {
      toast.success(`${cap(cfg.entity)} restored`);
      await invalidate(cfg.path);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const actionsColumn: ColumnDef<T, any> = {
    id: "actions",
    header: "",
    meta: { className: "w-12 text-right" },
    cell: ({ row }) => (
      <Can permission={cfg.writePermission}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions" onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!row.original.deletedAt && (
              <DropdownMenuItem onClick={() => setSheet({ mode: "edit", row: row.original })}>
                <Pencil /> Edit
              </DropdownMenuItem>
            )}
            {cfg.rowActions?.(row.original)}
            <DropdownMenuSeparator />
            {row.original.deletedAt ? (
              <DropdownMenuItem onClick={() => restore.mutate(row.original)}>
                <Undo2 /> Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onClick={() => setToArchive(row.original)}>
                <Archive /> {cfg.hardDelete ? "Delete" : "Archive"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </Can>
    ),
  };

  const columns = useMemo<ColumnDef<T, any>[]>(
    () => [
      ...cfg.columns,
      ...(archivable
        ? [{ id: "archived", header: "", meta: { label: "Archived" }, cell: ({ row }: { row: { original: T } }) => (row.original.deletedAt ? <Badge variant="secondary">Archived</Badge> : null) } as ColumnDef<T, any>]
        : []),
      actionsColumn,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cfg.columns, archivable],
  );

  return (
    <>
      {!cfg.embedded && (
        <PageHeader
          title={cfg.title}
          {...(cfg.description ? { description: cfg.description } : {})}
          actions={
            <>
              {cfg.headerActions}
              <Can permission={cfg.writePermission}>
                <Button onClick={() => setSheet({ mode: "create" })}>
                  <Plus /> New {cfg.entity}
                </Button>
              </Can>
            </>
          }
        />
      )}

      <DataTable
        columns={columns}
        rows={list.data?.data ?? []}
        total={list.data?.meta.total ?? 0}
        state={state}
        onChange={update}
        loading={list.isFetching}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => list.refetch()}
        searchPlaceholder={cfg.searchPlaceholder ?? `Search ${cfg.entity}s…`}
        emptyTitle={`No ${cfg.entity}s yet`}
        emptyDescription={cfg.emptyDescription}
        emptyAction={
          <Can permission={cfg.writePermission}>
            <Button onClick={() => setSheet({ mode: "create" })}>
              <Plus /> New {cfg.entity}
            </Button>
          </Can>
        }
        exportName={cfg.path.replace(/^\//, "")}
        toolbar={
          cfg.embedded ? (
            <Can permission={cfg.writePermission}>
              <Button size="sm" onClick={() => setSheet({ mode: "create" })}>
                <Plus /> New {cfg.entity}
              </Button>
            </Can>
          ) : undefined
        }
        getRowId={(r) => r.id}
        filters={
          <>
            {cfg.filters?.map((f) => (
              <Select key={f.key} value={state.filters[f.key] ?? "__all__"} onValueChange={(v) => update({ filters: { [f.key]: v === "__all__" ? undefined : v } })}>
                <SelectTrigger size="sm" className="w-[170px]" aria-label={f.label}>
                  <SelectValue placeholder={f.label} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All {f.label.toLowerCase()}</SelectItem>
                  {f.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
            {archivable && (
              <div className="flex items-center gap-2 text-sm">
                <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
                <Label htmlFor="show-archived" className="cursor-pointer text-muted-foreground">
                  Show archived
                </Label>
              </div>
            )}
          </>
        }
      />

      <RecordSheet cfg={cfg} sheet={sheet} onClose={() => setSheet(null)} onSaved={() => invalidate(cfg.path)} />

      <ConfirmDialog
        open={!!toArchive}
        onOpenChange={(o) => !o && setToArchive(null)}
        title={`${cfg.hardDelete ? "Delete" : "Archive"} this ${cfg.entity}?`}
        description={cfg.hardDelete ? "This cannot be undone." : "It disappears from lists and pickers but its history is kept. You can restore it later."}
        confirmLabel={cfg.hardDelete ? "Delete" : "Archive"}
        destructive
        busy={archive.isPending}
        onConfirm={() => toArchive && archive.mutate(toArchive)}
      />
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function RecordSheet<T extends Row>({ cfg, sheet, onClose, onSaved }: { cfg: CrudConfig<T>; sheet: { mode: "create" } | { mode: "edit"; row: T } | null; onClose: () => void; onSaved: () => void }) {
  const editing = sheet?.mode === "edit";
  const row = sheet?.mode === "edit" ? sheet.row : null;
  const schema = editing ? cfg.updateSchema : cfg.createSchema;
  const visibleFields = cfg.fields.filter((f) => (f.mode ?? "both") === "both" || (f.mode === "edit") === editing);

  // Validate the CLEANED values (empty optional text -> null, NaN -> undefined): exactly what the API will receive,
  // so an empty optional "logo URL" is not rejected as an invalid URL.
  const form = useForm<any>({
    resolver: (values, context, options) => zodResolver(schema as never)(NULLABLE_CLEAR(cfg.fields, values, !!editing), context, options as never) as never,
    defaultValues: cfg.defaults,
  });
  const { register, control, handleSubmit, reset, setError, formState } = form;
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!sheet) return;
    setFormError(null);
    const source = sheet.mode === "edit" ? (cfg.toForm ? cfg.toForm(sheet.row) : (sheet.row as Record<string, unknown>)) : cfg.defaults;
    const values: Record<string, unknown> = { ...source };
    // text inputs cannot hold null: show an empty box for a missing value
    for (const f of cfg.fields) {
      if ((f.type === "text" || f.type === "textarea" || f.type === "email" || f.type === "password") && values[f.name] == null) values[f.name] = "";
    }
    reset(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const cleaned = NULLABLE_CLEAR(cfg.fields, values, !!editing);
      const payload = cfg.prepare ? cfg.prepare(cleaned, !!editing) : cleaned;
      return editing && row ? api.patch(`${cfg.path}/${row.id}`, payload) : api.post(cfg.path, payload);
    },
    onSuccess: () => {
      toast.success(`${cap(cfg.entity)} ${editing ? "updated" : "created"}`);
      onSaved();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422) {
        let mapped = false;
        for (const [name, messages] of Object.entries(e.fieldErrors)) {
          if (visibleFields.some((f) => f.name === name)) {
            setError(name, { message: messages[0] ?? "Invalid" });
            mapped = true;
          }
        }
        if (!mapped) setFormError(e.message);
      } else setFormError(errorMessage(e));
    },
  });

  return (
    <Sheet open={!!sheet} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className={`flex w-full flex-col gap-0 overflow-y-auto ${cfg.wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}>
        <SheetHeader>
          <SheetTitle>{editing ? `Edit ${cfg.entity}` : `New ${cfg.entity}`}</SheetTitle>
          <SheetDescription>{editing ? "Changes are saved and recorded in the audit log." : `Fill in the details to create a ${cfg.entity}.`}</SheetDescription>
        </SheetHeader>

        <form id="record-form" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-4 px-4 py-2 sm:grid-cols-2">
          {formError && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive sm:col-span-2">
              {formError}
            </div>
          )}
          {visibleFields.map((f) => (
            <FieldControl key={f.name} field={f} register={register} control={control} errors={formState.errors} editing={!!editing} />
          ))}
        </form>

        {editing && row && cfg.extraSections && <div className="space-y-6 px-4 pb-4">{cfg.extraSections(row, onClose)}</div>}

        <SheetFooter className="mt-auto flex-row justify-end gap-2 border-t">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="record-form" disabled={save.isPending}>
            {save.isPending ? "Saving…" : editing ? "Save changes" : `Create ${cfg.entity}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
