import type { ColumnDef } from "@tanstack/react-table";
import { PackageMinus } from "lucide-react";
import { useState } from "react";
import { fmtDateTime } from "@/components/cells";
import { DataTable } from "@/components/data-table/DataTable";
import { useTableState } from "@/components/data-table/useTableState";
import { PageHeader } from "@/components/page/PageHeader";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { useList } from "@/lib/queries";
import { AdjustDialog } from "./AdjustDialog";
import { fmtQty, LocationSelect, MoveBadge, useLocationChoice, useMoney } from "./shared";

interface Move { id: string; type: string; qty: number; unitCost: number; reason: string | null; createdAt: string; itemName: string; unit: string; createdByName: string | null }

const GROUPS: { label: string; types: string }[] = [
  { label: "Waste and losses", types: "WASTE,EXPIRED,DAMAGE,STAFF_MEAL" },
  { label: "Corrections and counts", types: "ADJUSTMENT,COUNT,OPENING" },
  { label: "Everything", types: "" },
];

/** The stock ledger for one location, plus the form to record waste, expiry, a staff meal or a correction. Nothing here can be edited afterwards. */
export default function AdjustmentsPage() {
  const { locationId, setLocationId, locations, location } = useLocationChoice();
  const { money } = useMoney(location?.currencyCode);
  const { state, update } = useTableState("-createdAt", []);
  const [group, setGroup] = useState(0);
  const [open, setOpen] = useState(false);
  const types = GROUPS[group]!.types;
  const list = useList<Move>("/inventory/movements", state, { locationId, ...(types ? { types } : {}) }, !!locationId);

  const columns: ColumnDef<Move, any>[] = [
    { accessorKey: "createdAt", header: "When", meta: { label: "When" }, cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(getValue())}</span> },
    { accessorKey: "itemName", header: "Item", meta: { label: "Item" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { accessorKey: "type", header: "What", meta: { label: "What" }, cell: ({ getValue }) => <MoveBadge type={getValue()} /> },
    { accessorKey: "qty", header: "Quantity", meta: { label: "Quantity" }, cell: ({ row }) => <span className={`tabular-nums ${row.original.qty < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>{row.original.qty > 0 ? "+" : ""}{fmtQty(row.original.qty)} {row.original.unit}</span> },
    { id: "value", header: "Value", meta: { label: "Value" }, cell: ({ row }) => <span className="tabular-nums">{money(row.original.qty * row.original.unitCost)}</span> },
    { accessorKey: "reason", header: "Reason", meta: { label: "Reason" }, cell: ({ getValue }) => getValue() ?? <span className="text-muted-foreground">-</span> },
    { accessorKey: "createdByName", header: "By", meta: { label: "By" }, cell: ({ getValue }) => getValue() ?? "System" },
  ];

  return (
    <>
      <PageHeader title="Adjustments & waste" description="Everything that changed stock apart from sales and deliveries. Entries are permanent: a mistake is fixed with a new entry."
        actions={<div className="flex flex-wrap items-center gap-2"><LocationSelect value={locationId} onChange={setLocationId} locations={locations} /><Button onClick={() => setOpen(true)}><PackageMinus /> Record</Button></div>} />
      <div className="mb-3 inline-flex rounded-lg border p-0.5" role="tablist" aria-label="Show">
        {GROUPS.map((g, i) => <button key={g.label} type="button" role="tab" aria-selected={group === i} onClick={() => { setGroup(i); update({ page: 1 }); }} className={`rounded-md px-3 py-1.5 text-sm ${group === i ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{g.label}</button>)}
      </div>
      <DataTable columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update} loading={list.isFetching}
        error={list.isError ? errorMessage(list.error) : null} onRetry={() => void list.refetch()} exportName="stock-ledger" getRowId={(r) => r.id} hideSearch
        emptyTitle="Nothing recorded yet" emptyDescription="Waste, expiry, staff meals and corrections appear here." />
      {open && <AdjustDialog locationId={locationId} onClose={() => setOpen(false)} />}
    </>
  );
}
