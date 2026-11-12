import { SUPPLIER_PAYMENT_METHODS } from "@restoflux/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Receipt } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmtDate, fmtDateTime } from "@/components/cells";
import { DataTable } from "@/components/data-table/DataTable";
import { useTableState } from "@/components/data-table/useTableState";
import { PageHeader } from "@/components/page/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useMoney } from "@/features/inventory/shared";
import { SimpleSelect } from "@/features/menu/shared";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useInvalidate, useList } from "@/lib/queries";
import { INV_STATUSES, InvoiceBadge, useSuppliers } from "./shared";

interface InvRow { id: string; invoiceNo: string; supplierId: string; supplierName: string; invoiceDate: string; dueDate: string; totalMinor: number; paidMinor: number; outstandingMinor: number; status: string; overdue: boolean }
interface InvDetail extends InvRow { note: string | null; payments: { id: string; amountMinor: number; method: string; reference: string | null; paidAt: string }[]; order: { number: string; totalMinor: number } | null }
interface Payables { data: { supplierId: string; supplierName: string; invoices: number; outstandingMinor: number; overdueMinor: number }[]; meta: { outstandingMinor: number; overdueMinor: number } }

/** What you owe suppliers: enter their invoices, pay them off in parts or in full, and see what is overdue. */
export default function InvoicesPage() {
  const { me, can } = useAuth();
  const { money } = useMoney(me?.tenant.baseCurrency);
  const { state, update } = useTableState("dueDate", ["status", "supplierId"]);
  const [unpaid, setUnpaid] = useState(true);
  const list = useList<InvRow>("/supplier-invoices", state, unpaid ? { unpaid: true } : {});
  const suppliers = useSuppliers();
  const payables = useQuery({ queryKey: ["/supplier-invoices", "payables"], queryFn: () => api.get<Payables>("/supplier-invoices/payables") });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const columns: ColumnDef<InvRow, any>[] = [
    { accessorKey: "invoiceNo", header: "Invoice", meta: { label: "Invoice" }, cell: ({ getValue }) => <span className="font-semibold">{getValue()}</span> },
    { accessorKey: "supplierName", header: "Supplier", meta: { label: "Supplier" } },
    { accessorKey: "invoiceDate", header: "Dated", meta: { label: "Dated" }, cell: ({ getValue }) => <span className="text-muted-foreground">{fmtDate(getValue())}</span> },
    { accessorKey: "dueDate", header: "Due", meta: { sortKey: "dueDate", label: "Due" }, cell: ({ row }) => <span className={row.original.overdue ? "font-medium text-red-600 dark:text-red-400" : ""}>{fmtDate(row.original.dueDate)}</span> },
    { id: "total", header: "Total", meta: { label: "Total" }, cell: ({ row }) => <span className="tabular-nums">{money(row.original.totalMinor)}</span> },
    { id: "owed", header: "Owed", meta: { label: "Owed" }, cell: ({ row }) => <span className="font-medium tabular-nums">{money(row.original.outstandingMinor)}</span> },
    { accessorKey: "status", header: "Status", meta: { label: "Status" }, cell: ({ row }) => <InvoiceBadge status={row.original.status} overdue={row.original.overdue} /> },
  ];

  return (
    <>
      <PageHeader title="Invoices & payments" description="Supplier bills and what has been paid against them."
        actions={can("invoices.manage") ? <Button onClick={() => setCreating(true)}><Receipt /> Enter an invoice</Button> : undefined} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">You owe</div><div className="text-2xl font-bold tabular-nums">{payables.data ? money(payables.data.meta.outstandingMinor) : "-"}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Overdue</div><div className={`text-2xl font-bold tabular-nums ${payables.data && payables.data.meta.overdueMinor > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{payables.data ? money(payables.data.meta.overdueMinor) : "-"}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Largest balance</div><div className="truncate text-lg font-semibold">{payables.data?.data[0] ? `${payables.data.data[0].supplierName} · ${money(payables.data.data[0].outstandingMinor)}` : "-"}</div></CardContent></Card>
      </div>
      <DataTable columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update} loading={list.isFetching}
        error={list.isError ? errorMessage(list.error) : null} onRetry={() => void list.refetch()} getRowId={(r) => r.id} onRowClick={(r) => setOpen(r.id)} searchPlaceholder="Invoice number…"
        filters={<>
          <SimpleSelect className="w-44" allowEmpty emptyLabel="Any supplier" value={state.filters.supplierId ?? ""} onChange={(v) => update({ filters: { supplierId: v || undefined } })} label="Supplier" options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          {!unpaid && <SimpleSelect className="w-36" allowEmpty emptyLabel="Any status" value={state.filters.status ?? ""} onChange={(v) => update({ filters: { status: v || undefined } })} label="Status" options={INV_STATUSES} />}
          <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" className="size-4" checked={unpaid} onChange={(e) => setUnpaid(e.target.checked)} /> Only unpaid</label>
        </>}
        emptyTitle={unpaid ? "Nothing to pay" : "No invoices"} emptyDescription="Enter a supplier's invoice when it arrives so it can be tracked and paid." />
      {creating && <NewInvoice onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpen(id); }} />}
      {open && <InvoiceSheet id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function NewInvoice({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { me } = useAuth();
  const { toMinor, code } = useMoney(me?.tenant.baseCurrency);
  const suppliers = useSuppliers();
  const invalidate = useInvalidate();
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [due, setDue] = useState("");
  const [total, setTotal] = useState("");
  const terms = suppliers.data?.find((s) => s.id === supplierId)?.paymentTermsDays;
  const create = useMutation({
    mutationFn: async () => (await api.post<{ data: { id: string } }>("/supplier-invoices", { supplierId, invoiceNo: invoiceNo.trim(), invoiceDate: date, ...(due ? { dueDate: due } : {}), totalMinor: toMinor(Number(total)) })).data,
    onSuccess: async (i) => { toast.success("Invoice entered"); await invalidate("/supplier-invoices"); onCreated(i.id); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Enter an invoice</DialogTitle><DialogDescription>The due date follows the supplier's payment terms unless you set one.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label>Supplier</Label><SimpleSelect value={supplierId} onChange={setSupplierId} label="Supplier" options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))} placeholder="Choose a supplier" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="inv-no">Invoice number</Label><Input id="inv-no" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="inv-total">Total ({code})</Label><Input id="inv-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="inv-date">Invoice date</Label><Input id="inv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="inv-due">Due date</Label><Input id="inv-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />{terms !== undefined && !due && <p className="text-xs text-muted-foreground">{terms === 0 ? "Due on the invoice date." : `${terms} days after the invoice date.`}</p>}</div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!supplierId || !invoiceNo.trim() || !(Number(total) > 0) || create.isPending} onClick={() => create.mutate()}>Save invoice</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { me } = useAuth();
  const { money, toMinor, toMajor } = useMoney(me?.tenant.baseCurrency);
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: ["/supplier-invoices", "one", id], queryFn: async () => (await api.get<{ data: InvDetail }>(`/supplier-invoices/${id}`)).data });
  const inv = q.data;
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>(SUPPLIER_PAYMENT_METHODS[1]);
  const [reference, setReference] = useState("");
  const refresh = async () => { await invalidate("/supplier-invoices"); await q.refetch(); };
  const pay = useMutation({
    mutationFn: () => api.post(`/supplier-invoices/${id}/payments`, { amountMinor: toMinor(Number(amount)), method, reference: reference.trim() || null }),
    onSuccess: async () => { toast.success("Payment recorded"); setAmount(""); setReference(""); await refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const voidIt = useMutation({ mutationFn: () => api.post(`/supplier-invoices/${id}/void`, {}), onSuccess: async () => { toast.success("Invoice voided"); await refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const payable = inv && (inv.status === "OPEN" || inv.status === "PARTIALLY_PAID");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{inv ? `${inv.invoiceNo} · ${inv.supplierName}` : "Invoice"}</DialogTitle><DialogDescription>{inv && <InvoiceBadge status={inv.status} overdue={inv.overdue} />}</DialogDescription></DialogHeader>
        {!inv ? <Skeleton className="h-40 w-full" /> : (
          <>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Dated</dt><dd className="text-right">{fmtDate(inv.invoiceDate)}</dd>
              <dt className="text-muted-foreground">Due</dt><dd className="text-right">{fmtDate(inv.dueDate)}</dd>
              <dt className="text-muted-foreground">Total</dt><dd className="text-right tabular-nums">{money(inv.totalMinor)}</dd>
              <dt className="text-muted-foreground">Paid</dt><dd className="text-right tabular-nums">{money(inv.paidMinor)}</dd>
              <dt className="font-semibold">Owed</dt><dd className="text-right font-semibold tabular-nums">{money(inv.outstandingMinor)}</dd>
            </dl>
            {inv.payments.length > 0 && <div className="divide-y rounded-lg border text-sm">{inv.payments.map((p) => <div key={p.id} className="flex justify-between px-3 py-2"><span>{fmtDateTime(p.paidAt)} · {p.method}{p.reference ? ` (${p.reference})` : ""}</span><span className="tabular-nums">{money(p.amountMinor)}</span></div>)}</div>}
            {payable && (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1"><Label htmlFor="pay-amt">Amount</Label><div className="flex gap-1"><Input id="pay-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /><Button type="button" variant="outline" size="sm" onClick={() => setAmount(String(toMajor(inv.outstandingMinor)))}>All</Button></div></div>
                  <div className="space-y-1"><Label>Method</Label><SimpleSelect value={method} onChange={setMethod} label="Method" options={SUPPLIER_PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} /></div>
                  <div className="space-y-1"><Label htmlFor="pay-ref">Reference</Label><Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
                </div>
                <Button disabled={!(Number(amount) > 0) || pay.isPending} onClick={() => pay.mutate()}>Record payment</Button>
              </div>
            )}
            <DialogFooter className="sm:justify-between">
              {inv.paidMinor === 0 && inv.status !== "VOID" ? <Button variant="ghost" disabled={voidIt.isPending} onClick={() => voidIt.mutate()}>Void invoice</Button> : <span />}
              <Button variant="outline" onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

