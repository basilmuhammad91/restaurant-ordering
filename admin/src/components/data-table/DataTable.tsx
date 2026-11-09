import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type VisibilityState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { EmptyState, ErrorState, LoadingRows } from "@/components/page/states";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TableState } from "./useTableState";

// A server-side data table: the API does the searching, sorting and paging (so it works for 100k rows),
// TanStack Table renders it and handles column visibility.
// Column meta (all optional):  sortKey = API field to sort by;  label = name used in the column menu and CSV.

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    sortKey?: string;
    label?: string;
    className?: string;
  }
}

interface DataTableProps<T> {
  columns: ColumnDef<T, any>[];
  rows: T[];
  total: number;
  state: TableState;
  onChange: (patch: { page?: number; pageSize?: number; sort?: string; q?: string }) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Extra filter controls shown next to the search box. */
  filters?: ReactNode;
  /** Buttons on the right of the toolbar. */
  toolbar?: ReactNode;
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  exportName?: string;
  onRowClick?: (row: T) => void;
  getRowId?: (row: T) => string;
  hideSearch?: boolean;
}

function SortHeader({ label, sortKey, sort, onSort }: { label: ReactNode; sortKey: string; sort: string; onSort: (s: string) => void }) {
  const active = sort === sortKey || sort === `-${sortKey}`;
  const Icon = !active ? ArrowUpDown : sort.startsWith("-") ? ArrowDown : ArrowUp;
  return (
    <button type="button" className="-ml-2 inline-flex items-center gap-1 rounded px-2 py-1 font-medium hover:bg-accent" onClick={() => onSort(sort === sortKey ? `-${sortKey}` : sortKey)}>
      {label}
      <Icon className={`size-3.5 ${active ? "" : "text-muted-foreground"}`} />
    </button>
  );
}

export function DataTable<T>({
  columns, rows, total, state, onChange, loading, error, onRetry, filters, toolbar, searchPlaceholder = "Search…",
  emptyTitle = "Nothing here yet", emptyDescription, emptyAction, exportName, onRowClick, getRowId, hideSearch,
}: DataTableProps<T>) {
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [search, setSearch] = useState(state.q);
  useEffect(() => setSearch(state.q), [state.q]);

  // debounce typing: one request per pause, not per keystroke
  useEffect(() => {
    if (search === state.q) return;
    const t = setTimeout(() => onChange({ q: search }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    ...(getRowId ? { getRowId } : {}),
  });

  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  const from = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const to = Math.min(total, state.page * state.pageSize);

  function exportCsv() {
    const cols = table.getVisibleLeafColumns().filter((c) => c.id !== "actions");
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = cols.map((c) => esc(c.columnDef.meta?.label ?? (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id)));
    const body = table.getRowModel().rows.map((r) => cols.map((c) => esc(r.getValue(c.id))).join(","));
    const blob = new Blob([[header.join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!hideSearch && (
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} aria-label="Search" />
          </div>
        )}
        {filters}
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 /> Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table.getAllLeafColumns().filter((c) => c.id !== "actions").map((c) => (
                <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)}>
                  {c.columnDef.meta?.label ?? (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download /> CSV
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} {...(onRetry ? { onRetry } : {})} />
      ) : loading && rows.length === 0 ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <EmptyState title={state.q || Object.keys(state.filters).length ? "No results" : emptyTitle} description={state.q || Object.keys(state.filters).length ? "Try a different search or clear the filters." : emptyDescription} action={emptyAction} />
      ) : (
        <div className={`overflow-hidden rounded-xl border bg-card ${loading ? "opacity-60" : ""}`}>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => {
                    const sortKey = h.column.columnDef.meta?.sortKey;
                    return (
                      <TableHead key={h.id} className={h.column.columnDef.meta?.className}>
                        {h.isPlaceholder ? null : sortKey ? (
                          <SortHeader label={flexRender(h.column.columnDef.header, h.getContext())} sortKey={sortKey} sort={state.sort} onSort={(s) => onChange({ sort: s })} />
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className={onRowClick ? "cursor-pointer" : ""} {...(onRowClick ? { onClick: () => onRowClick(row.original) } : {})}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            {from}-{to} of {total}
          </span>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">Rows</span>
            <Select value={String(state.pageSize)} onValueChange={(v) => onChange({ pageSize: Number(v) })}>
              <SelectTrigger size="sm" className="w-[72px]" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="size-8" disabled={state.page <= 1} onClick={() => onChange({ page: state.page - 1 })} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span>
              {state.page} / {pages}
            </span>
            <Button variant="outline" size="icon" className="size-8" disabled={state.page >= pages} onClick={() => onChange({ page: state.page + 1 })} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
