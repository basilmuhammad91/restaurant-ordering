import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmtDate, fmtDateTime } from "@/components/cells";
import { PageHeader } from "@/components/page/PageHeader";
import { ErrorState } from "@/components/page/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranches } from "@/features/orders/common";
import { ZReportDialog } from "@/features/orders/ShiftsPage";
import { SimpleSelect } from "@/features/menu/shared";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useInvalidate } from "@/lib/queries";
import { useScope } from "@/lib/scope";

interface Z { id: string; locationId: string; locationName: string | null; businessDate: string; scope: "SHIFT" | "DAY"; generatedAt: string }

/** End-of-day (Z) reports: a frozen copy of a shift's or a day's figures, kept so the numbers can never change afterwards. */
export default function ZReportsPage() {
  const { can } = useAuth();
  const branches = useBranches();
  const { range } = useScope();
  const invalidate = useInvalidate();
  const [locationId, setLocationId] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const q = useQuery({ queryKey: ["/z-reports", locationId, range.from, range.to], queryFn: async () => (await api.get<{ data: Z[] }>("/z-reports", { from: range.from, to: range.to, ...(locationId ? { locationId } : {}) })).data });

  return (
    <>
      <PageHeader title="End of day / Z reports" description={`Reports saved from ${range.from} to ${range.to} (the range in the top bar).`}
        actions={<div className="flex flex-wrap items-center gap-2">
          <SimpleSelect className="w-48" allowEmpty emptyLabel="All branches" value={locationId} onChange={setLocationId} label="Branch" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          {can("zreport.view") && <Button onClick={() => setMaking(true)}><FileText /> End-of-day report</Button>}
        </div>} />
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Trading day</TableHead><TableHead>Branch</TableHead><TableHead>Covers</TableHead><TableHead>Created</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
            <TableBody>
              {q.isPending ? [0, 1, 2].map((i) => <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)
                : (q.data ?? []).length === 0 ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No reports in this period. Closing a shift saves one automatically, or create the day's report here.</TableCell></TableRow>
                : q.data!.map((z) => (
                  <TableRow key={z.id} className="cursor-pointer" onClick={() => setOpen(z.id)}>
                    <TableCell className="font-medium">{fmtDate(z.businessDate)}</TableCell>
                    <TableCell>{z.locationName ?? "-"}</TableCell>
                    <TableCell><Badge variant="secondary">{z.scope === "DAY" ? "Whole day" : "One shift"}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{fmtDateTime(z.generatedAt)}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="ghost">View</Button></TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}
      {making && <MakeDay branches={branches} onClose={() => setMaking(false)} onMade={async (id) => { setMaking(false); await invalidate("/z-reports"); setOpen(id); }} />}
      {open && <ZReportDialog id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function MakeDay({ branches, onClose, onMade }: { branches: { id: string; name: string }[]; onClose: () => void; onMade: (id: string) => void }) {
  const [locationId, setLocationId] = useState(branches[0]?.id ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const make = useMutation({
    mutationFn: async () => (await api.post<{ data: { id: string } }>("/z-reports/day", { locationId, businessDate: date })).data,
    onSuccess: (z) => onMade(z.id), onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>End-of-day report</DialogTitle><DialogDescription>Adds up every shift, payment and tax for one branch and trading day, and saves a copy.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label>Branch</Label><SimpleSelect value={locationId} onChange={setLocationId} label="Branch" options={branches.map((b) => ({ value: b.id, label: b.name }))} /></div>
        <div className="space-y-1.5"><Label htmlFor="z-date">Trading day</Label><Input id="z-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!locationId || !date || make.isPending} onClick={() => make.mutate()}>Create report</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
