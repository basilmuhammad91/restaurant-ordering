import { APPROVAL_STATUSES, APPROVAL_TYPES } from "@restoflux/contracts";
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Can } from "@/components/Can";
import { fmtDateTime, titleCase } from "@/components/cells";
import { DataTable } from "@/components/data-table/DataTable";
import { useTableState } from "@/components/data-table/useTableState";
import { PageHeader } from "@/components/page/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { formatMinor, useCurrencies } from "@/lib/money";
import { useInvalidate, useList } from "@/lib/queries";

interface Approval {
  id: string;
  type: string;
  status: string;
  reason: string;
  amountMinor: number | null;
  currencyCode: string | null;
  method: string;
  expiresAt: string;
  createdAt: string;
  decisionNote: string | null;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
}

const statusTone: Record<string, string> = {
  PENDING: "bg-amber-500/15 text-amber-700 dark:text-amber-400", APPROVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  CONSUMED: "bg-sky-500/15 text-sky-700 dark:text-sky-400", REJECTED: "bg-red-500/15 text-red-700 dark:text-red-400", EXPIRED: "bg-muted text-muted-foreground", CANCELLED: "bg-muted text-muted-foreground",
};

export default function ApprovalsPage() {
  const { exponent } = useCurrencies();
  const { state, update } = useTableState("-createdAt", ["status", "type"]);
  // pending first: the inbox view is the default
  const effective = { ...state, filters: { status: "PENDING", ...state.filters } };
  const list = useList<Approval>("/approvals", effective);
  const invalidate = useInvalidate();
  const [deciding, setDeciding] = useState<{ row: Approval; decision: "APPROVE" | "REJECT" } | null>(null);
  const [note, setNote] = useState("");

  const decide = useMutation({
    mutationFn: ({ row, decision }: { row: Approval; decision: "APPROVE" | "REJECT" }) => api.post(`/approvals/${row.id}/decision`, { decision, note: note.trim() || undefined }),
    onSuccess: async (_d, v) => { toast.success(v.decision === "APPROVE" ? "Approved" : "Rejected"); setDeciding(null); setNote(""); await invalidate("/approvals", "/notifications"); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: ColumnDef<Approval, any>[] = [
    { accessorKey: "type", header: "Request", meta: { label: "Type" }, cell: ({ getValue }) => <span className="font-medium">{titleCase(getValue())}</span> },
    { id: "who", header: "Requested by", meta: { label: "Requested by" }, accessorFn: (r) => r.requestedBy.name },
    { id: "amount", header: "Amount", meta: { label: "Amount" }, accessorFn: (r) => (r.amountMinor != null && r.currencyCode ? formatMinor(r.amountMinor, r.currencyCode, exponent(r.currencyCode)) : "-") },
    { accessorKey: "reason", header: "Reason", cell: ({ getValue }) => <span className="line-clamp-2 max-w-xs">{getValue()}</span> },
    { accessorKey: "status", header: "Status", cell: ({ row }) => (<div><Badge variant="secondary" className={statusTone[row.original.status]}>{titleCase(row.original.status)}</Badge>{row.original.decidedBy && <div className="mt-0.5 text-xs text-muted-foreground">by {row.original.decidedBy.name}</div>}</div>) },
    { accessorKey: "createdAt", header: "Requested", meta: { label: "Requested" }, cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(getValue())}</span> },
    {
      id: "actions", header: "", meta: { className: "w-40 text-right" },
      cell: ({ row }) =>
        row.original.status === "PENDING" ? (
          <Can permission="approvals.decide">
            <div className="flex justify-end gap-1">
              <Button size="sm" onClick={() => setDeciding({ row: row.original, decision: "APPROVE" })}><Check /> Approve</Button>
              <Button size="sm" variant="outline" onClick={() => setDeciding({ row: row.original, decision: "REJECT" })}><X /> Reject</Button>
            </div>
          </Can>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title="Approvals" description="Voids, refunds, large discounts and purchase orders that need a manager. Requests above your own limit can't be approved by you." />
      <DataTable
        columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={effective} onChange={update}
        loading={list.isFetching} error={list.isError ? errorMessage(list.error) : null} onRetry={() => list.refetch()} hideSearch exportName="approvals"
        emptyTitle="Nothing waiting for approval" emptyDescription="When staff ask for a void, refund or large discount, it appears here."
        filters={
          <>
            <Select value={effective.filters.status ?? "PENDING"} onValueChange={(v) => update({ filters: { status: v } })}>
              <SelectTrigger size="sm" className="w-40" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>{APPROVAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={state.filters.type ?? "__all__"} onValueChange={(v) => update({ filters: { type: v === "__all__" ? undefined : v } })}>
              <SelectTrigger size="sm" className="w-44" aria-label="Type"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All types</SelectItem>{APPROVAL_TYPES.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
            </Select>
          </>
        }
      />

      <Dialog open={!!deciding} onOpenChange={(o) => { if (!o) { setDeciding(null); setNote(""); } }}>
        <DialogContent>
          {deciding && (
            <>
              <DialogHeader>
                <DialogTitle>{deciding.decision === "APPROVE" ? "Approve" : "Reject"} {titleCase(deciding.row.type).toLowerCase()}?</DialogTitle>
                <DialogDescription>
                  {deciding.row.requestedBy.name} asked: "{deciding.row.reason}"
                  {deciding.row.amountMinor != null && deciding.row.currencyCode ? ` · ${formatMinor(deciding.row.amountMinor, deciding.row.currencyCode, exponent(deciding.row.currencyCode))}` : ""}
                </DialogDescription>
              </DialogHeader>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the requester" rows={3} maxLength={300} />
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeciding(null)}>Cancel</Button>
                <Button variant={deciding.decision === "APPROVE" ? "default" : "destructive"} disabled={decide.isPending} onClick={() => decide.mutate(deciding)}>
                  {decide.isPending ? "Saving…" : deciding.decision === "APPROVE" ? "Approve" : "Reject"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
