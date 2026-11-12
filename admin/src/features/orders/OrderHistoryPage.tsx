import { ORDER_STATUSES } from "@restoflux/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { useState } from "react";
import { fmtDateTime } from "@/components/cells";
import { DataTable } from "@/components/data-table/DataTable";
import { useTableState } from "@/components/data-table/useTableState";
import { PageHeader } from "@/components/page/PageHeader";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/features/menu/shared";
import type { PosOrder } from "@/features/pos/types";
import { errorMessage } from "@/lib/api";
import { formatMinor, useCurrencies } from "@/lib/money";
import { useList } from "@/lib/queries";
import { useScope } from "@/lib/scope";
import { OrderDetail } from "./OrderDetail";
import { PAYMENT_LABEL, PaymentBadge, STATUS_LABEL, StatusBadge, TYPE_LABEL, useBranches } from "./common";

/** Every order, with search and filters. Open one to see what was sold and paid, print the receipt, void or refund. */
export default function OrderHistoryPage() {
  const { exponent } = useCurrencies();
  const branches = useBranches();
  const { range } = useScope();
  const { state, update } = useTableState("-placedAt", ["locationId", "status", "paymentStatus", "orderType"]);
  const [useRange, setUseRange] = useState(true);
  const list = useList<PosOrder>("/orders", state, useRange ? { from: range.from, to: range.to } : {});
  const [open, setOpen] = useState<string | null>(null);

  const columns: ColumnDef<PosOrder, any>[] = [
    { accessorKey: "displayNumber", header: "Order", meta: { sortKey: "displayNumber", label: "Order" }, cell: ({ row }) => <span className="font-semibold">{row.original.orderNumber}</span> },
    { accessorKey: "placedAt", header: "When", meta: { sortKey: "placedAt", label: "When" }, cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(getValue())}</span> },
    { id: "type", header: "Type", meta: { label: "Type" }, cell: ({ row }) => <div><div>{TYPE_LABEL[row.original.orderType]}</div><div className="text-xs text-muted-foreground">{row.original.location.name}</div></div> },
    { id: "customer", header: "Customer", meta: { label: "Customer" }, accessorFn: (r) => r.customerName ?? r.customerPhone ?? "-" },
    { id: "items", header: "Items", meta: { label: "Items" }, cell: ({ row }) => <span className="block max-w-56 truncate text-sm text-muted-foreground">{row.original.lines.filter((l) => l.kind !== "COMBO_ITEM" && l.status !== "VOIDED").map((l) => `${l.quantity}× ${l.nameSnapshot}`).join(", ")}</span> },
    { accessorKey: "totalMinor", header: "Total", meta: { sortKey: "totalMinor", label: "Total" }, cell: ({ row }) => <span className="whitespace-nowrap font-medium tabular-nums">{formatMinor(row.original.totalMinor, row.original.currencyCode, exponent(row.original.currencyCode))}</span> },
    { accessorKey: "status", header: "Status", meta: { sortKey: "status", label: "Status" }, cell: ({ getValue }) => <StatusBadge status={getValue()} /> },
    { accessorKey: "paymentStatus", header: "Payment", meta: { label: "Payment" }, cell: ({ getValue }) => <PaymentBadge status={getValue()} /> },
  ];

  return (
    <>
      <PageHeader title="Order history" description={useRange ? `Orders from ${format(new Date(`${range.from}T00:00:00`), "d MMM")} to ${format(new Date(`${range.to}T00:00:00`), "d MMM yyyy")} (the range in the top bar).` : "All orders."} />
      <DataTable
        columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update} loading={list.isFetching}
        error={list.isError ? errorMessage(list.error) : null} onRetry={() => void list.refetch()} exportName="orders" getRowId={(r) => r.id} onRowClick={(r) => setOpen(r.id)}
        searchPlaceholder="Order number, customer, phone…" emptyTitle="No orders found" emptyDescription="Try a wider date range in the top bar, or clear the filters."
        filters={
          <>
            <SimpleSelect className="w-44" emptyLabel="All branches" allowEmpty value={state.filters.locationId ?? ""} onChange={(v) => update({ filters: { locationId: v || undefined } })} options={branches.map((b) => ({ value: b.id, label: b.name }))} label="Branch" />
            <SimpleSelect className="w-36" emptyLabel="Any status" allowEmpty value={state.filters.status ?? ""} onChange={(v) => update({ filters: { status: v || undefined } })} options={ORDER_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s }))} label="Status" />
            <SimpleSelect className="w-36" emptyLabel="Any payment" allowEmpty value={state.filters.paymentStatus ?? ""} onChange={(v) => update({ filters: { paymentStatus: v || undefined } })} options={Object.entries(PAYMENT_LABEL).map(([value, label]) => ({ value, label }))} label="Payment" />
            <SimpleSelect className="w-36" emptyLabel="Any type" allowEmpty value={state.filters.orderType ?? ""} onChange={(v) => update({ filters: { orderType: v || undefined } })} options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} label="Type" />
            <label className="flex items-center gap-2 text-sm text-muted-foreground"><Input type="checkbox" className="size-4" checked={useRange} onChange={(e) => setUseRange(e.target.checked)} aria-label="Use the date range in the top bar" /> Date range</label>
          </>
        }
      />
      {open && <OrderDetail orderId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
