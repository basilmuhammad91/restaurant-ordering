import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CookingPot } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmtDateTime } from "@/components/cells";
import { DataTable } from "@/components/data-table/DataTable";
import { useTableState } from "@/components/data-table/useTableState";
import { PageHeader } from "@/components/page/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/features/menu/shared";
import { api, errorMessage } from "@/lib/api";
import { useInvalidate, useList } from "@/lib/queries";
import { fmtQty, LocationSelect, useInvOptions, useLocationChoice } from "./shared";

interface Run { id: string; itemName: string; unit: string; producedQty: number; locationName: string; note: string | null; createdAt: string }

/** Cooking in bulk (sauces, marinades, dough): ingredients come out of stock, the prepared item goes in at their cost. */
export default function ProductionPage() {
  const { state, update } = useTableState("-createdAt", []);
  const list = useList<Run>("/production", state);
  const [open, setOpen] = useState(false);
  const columns: ColumnDef<Run, any>[] = [
    { accessorKey: "createdAt", header: "When", meta: { label: "When" }, cell: ({ getValue }) => <span className="text-muted-foreground">{fmtDateTime(getValue())}</span> },
    { accessorKey: "itemName", header: "Made", meta: { label: "Made" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { id: "qty", header: "Quantity", meta: { label: "Quantity" }, cell: ({ row }) => <span className="tabular-nums">{fmtQty(row.original.producedQty)} {row.original.unit}</span> },
    { accessorKey: "locationName", header: "Where", meta: { label: "Where" } },
    { accessorKey: "note", header: "Note", meta: { label: "Note" }, cell: ({ getValue }) => getValue() ?? "-" },
  ];
  return (
    <>
      <PageHeader title="Production" description="Record a batch made in a kitchen. It needs a batch recipe under Inventory > Recipes."
        actions={<Button onClick={() => setOpen(true)}><CookingPot /> New batch</Button>} />
      <DataTable columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update} loading={list.isFetching}
        error={list.isError ? errorMessage(list.error) : null} onRetry={() => void list.refetch()} getRowId={(r) => r.id} hideSearch
        emptyTitle="No batches yet" emptyDescription="Add a prep item and a batch recipe, then record your first batch." />
      {open && <NewBatch onClose={() => setOpen(false)} />}
    </>
  );
}

function NewBatch({ onClose }: { onClose: () => void }) {
  const { locationId, setLocationId, locations } = useLocationChoice();
  const { items } = useInvOptions();
  const invalidate = useInvalidate();
  const [prepItemId, setPrepItemId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const prep = items.filter((i) => i.kind === "PREP");
  const unit = prep.find((p) => p.id === prepItemId)?.unit ?? "";
  const save = useMutation({
    mutationFn: () => api.post("/production", { locationId, prepItemId, producedQty: Number(qty), note: note.trim() || null }),
    onSuccess: async () => { toast.success("Batch recorded"); await invalidate("/production", "/inventory"); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New batch</DialogTitle><DialogDescription>Ingredients are taken from this location's stock according to the recipe.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label>Where</Label><LocationSelect className="w-full" value={locationId} onChange={setLocationId} locations={locations} /></div>
        <div className="space-y-1.5"><Label>What was made</Label><SimpleSelect value={prepItemId} onChange={setPrepItemId} label="Prep item" options={prep.map((p) => ({ value: p.id, label: p.name }))} placeholder={prep.length ? "Choose a prep item" : "No prep items yet (add one under Items)"} /></div>
        <div className="space-y-1.5"><Label htmlFor="batch-qty">How much came out{unit ? ` (${unit})` : ""}</Label><Input id="batch-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="batch-note">Note (optional)</Label><Input id="batch-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!prepItemId || !(Number(qty) > 0) || save.isPending} onClick={() => save.mutate()}>Record batch</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
