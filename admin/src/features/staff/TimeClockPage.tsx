import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { LogIn, LogOut } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmtDateTime } from "@/components/cells";
import { DataTable } from "@/components/data-table/DataTable";
import { useTableState } from "@/components/data-table/useTableState";
import { PageHeader } from "@/components/page/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMoney } from "@/features/inventory/shared";
import { SimpleSelect } from "@/features/menu/shared";
import { useBranches } from "@/features/orders/common";
import { api, errorMessage, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useInvalidate, useList } from "@/lib/queries";
import { useScope } from "@/lib/scope";

interface Entry { id: string; employeeId: string; employeeName: string; position: string | null; locationName: string; clockInAt: string; clockOutAt: string | null; breakMinutes: number; hours: number; isOpen: boolean }
interface Summary { data: { employeeId: string; name: string; position: string | null; entries: number; hours: number; laborCostMinor: number | null }[]; meta: { totalHours: number; laborCostMinor: number } }

/** Local date-time for a datetime-local input, from an ISO instant. */
const toLocalInput = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/** Who is on the clock, hours worked, and a labour-cost estimate from each person's hourly rate. */
export default function TimeClockPage() {
  const { me, can } = useAuth();
  const manage = can("timeclock.manage");
  const branches = useBranches();
  const { range } = useScope();
  const { money } = useMoney(me?.tenant.baseCurrency);
  const invalidate = useInvalidate();
  const open = useQuery({ queryKey: ["/timeclock", "open"], refetchInterval: 30_000, queryFn: async () => (await api.get<{ data: Entry[] }>("/timeclock/open")).data });
  const summary = useQuery({ queryKey: ["/timeclock", "summary", range.from, range.to], queryFn: () => api.get<Summary>("/timeclock/summary", { from: range.from, to: range.to }) });
  const { state, update } = useTableState("-clockInAt", []);
  const list = useList<Entry>("/timeclock", state, { from: range.from, to: range.to });
  const [clockingOut, setClockingOut] = useState<Entry | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);

  const columns: ColumnDef<Entry, any>[] = [
    { accessorKey: "employeeName", header: "Person", meta: { label: "Person" }, cell: ({ row }) => <div><div className="font-medium">{row.original.employeeName}</div><div className="text-xs text-muted-foreground">{row.original.locationName}</div></div> },
    { accessorKey: "clockInAt", header: "In", meta: { label: "In" }, cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDateTime(getValue())}</span> },
    { accessorKey: "clockOutAt", header: "Out", meta: { label: "Out" }, cell: ({ row }) => (row.original.isOpen ? <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">On the clock</Badge> : <span className="whitespace-nowrap">{fmtDateTime(row.original.clockOutAt)}</span>) },
    { accessorKey: "breakMinutes", header: "Break", meta: { label: "Break" }, cell: ({ getValue }) => `${getValue()} min` },
    { accessorKey: "hours", header: "Hours", meta: { label: "Hours" }, cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
  ];

  return (
    <>
      <PageHeader title="Time clock" description={`Hours from ${range.from} to ${range.to} (the range in the top bar).`} />
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">On the clock now</CardTitle><CardDescription>{(open.data ?? []).length} {(open.data ?? []).length === 1 ? "person" : "people"}</CardDescription></CardHeader>
          <CardContent>
            {(open.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nobody is clocked in.</p> : (
              <div className="divide-y rounded-lg border">{open.data!.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div><span className="font-medium">{e.employeeName}</span> <span className="text-muted-foreground">· {e.locationName} · since {fmtDateTime(e.clockInAt)} ({e.hours} h)</span></div>
                  {manage && <Button size="sm" variant="outline" onClick={() => setClockingOut(e)}><LogOut /> Clock out</Button>}
                </div>
              ))}</div>
            )}
          </CardContent>
        </Card>
        {manage && <ClockIn branches={branches} onDone={() => void invalidate("/timeclock")} />}
      </div>

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Hours and labour cost</CardTitle><CardDescription>Cost is hours times each person's hourly rate, so it is an estimate.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Person</TableHead><TableHead className="text-right">Shifts</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Estimated cost</TableHead></TableRow></TableHeader>
            <TableBody>
              {(summary.data?.data ?? []).length === 0 ? <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No hours recorded in this period.</TableCell></TableRow>
                : summary.data!.data.map((r) => <TableRow key={r.employeeId}><TableCell><span className="font-medium">{r.name}</span>{r.position && <span className="ml-2 text-xs text-muted-foreground">{r.position}</span>}</TableCell><TableCell className="text-right tabular-nums">{r.entries}</TableCell><TableCell className="text-right tabular-nums">{r.hours}</TableCell><TableCell className="text-right tabular-nums">{r.laborCostMinor === null ? <span className="text-muted-foreground">no rate</span> : money(r.laborCostMinor)}</TableCell></TableRow>)}
              {summary.data && summary.data.data.length > 0 && <TableRow><TableCell className="font-semibold">Total</TableCell><TableCell /><TableCell className="text-right font-semibold tabular-nums">{summary.data.meta.totalHours}</TableCell><TableCell className="text-right font-semibold tabular-nums">{money(summary.data.meta.laborCostMinor)}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DataTable columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update} loading={list.isFetching}
        error={list.isError ? errorMessage(list.error) : null} onRetry={() => void list.refetch()} getRowId={(r) => r.id} onRowClick={manage ? (r) => setEditing(r) : undefined} hideSearch
        emptyTitle="No time entries" emptyDescription="Clock someone in to start recording hours." />
      {clockingOut && <ClockOut entry={clockingOut} onClose={() => setClockingOut(null)} />}
      {editing && <Adjust entry={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ClockIn({ branches, onDone }: { branches: { id: string; name: string }[]; onDone: () => void }) {
  const emps = useQuery({ queryKey: ["/employees", "active"], queryFn: async () => (await api.get<Paged<{ id: string; name: string; locationId: string | null }>>("/employees", { isActive: true, pageSize: 100 })).data });
  const [employeeId, setEmployeeId] = useState("");
  const [locationId, setLocationId] = useState("");
  const home = emps.data?.find((e) => e.id === employeeId)?.locationId;
  const branch = locationId || home || branches[0]?.id || "";
  const save = useMutation({ mutationFn: () => api.post("/timeclock/clock-in", { employeeId, locationId: branch }), onSuccess: () => { toast.success("Clocked in"); setEmployeeId(""); onDone(); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Clock someone in</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <SimpleSelect value={employeeId} onChange={setEmployeeId} label="Person" options={(emps.data ?? []).map((e) => ({ value: e.id, label: e.name }))} placeholder="Choose a person" />
        <SimpleSelect value={branch} onChange={setLocationId} label="Branch" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        <Button className="w-full" disabled={!employeeId || !branch || save.isPending} onClick={() => save.mutate()}><LogIn /> Clock in</Button>
      </CardContent>
    </Card>
  );
}

function ClockOut({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [brk, setBrk] = useState(String(entry.breakMinutes || 0));
  const save = useMutation({ mutationFn: () => api.post("/timeclock/clock-out", { employeeId: entry.employeeId, breakMinutes: Number(brk) || 0 }), onSuccess: async () => { toast.success("Clocked out"); await invalidate("/timeclock"); onClose(); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Clock out {entry.employeeName}</DialogTitle><DialogDescription>On the clock since {fmtDateTime(entry.clockInAt)}.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label htmlFor="co-break">Unpaid break (minutes)</Label><Input id="co-break" inputMode="numeric" value={brk} onChange={(e) => setBrk(e.target.value)} /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>Clock out</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Adjust({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [inAt, setInAt] = useState(toLocalInput(entry.clockInAt));
  const [outAt, setOutAt] = useState(toLocalInput(entry.clockOutAt));
  const [brk, setBrk] = useState(String(entry.breakMinutes));
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => api.patch(`/timeclock/${entry.id}`, { clockInAt: new Date(inAt).toISOString(), clockOutAt: outAt ? new Date(outAt).toISOString() : null, breakMinutes: Number(brk) || 0, reason: reason.trim() }),
    onSuccess: async () => { toast.success("Times corrected"); await invalidate("/timeclock"); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Correct times for {entry.employeeName}</DialogTitle><DialogDescription>The change and your reason are kept in the audit log.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="adj-in">Clocked in</Label><Input id="adj-in" type="datetime-local" value={inAt} onChange={(e) => setInAt(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="adj-out">Clocked out</Label><Input id="adj-out" type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="adj-brk">Unpaid break (minutes)</Label><Input id="adj-brk" inputMode="numeric" value={brk} onChange={(e) => setBrk(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="adj-why">Why</Label><Input id="adj-why" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Forgot to clock out…" /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!inAt || !reason.trim() || save.isPending} onClick={() => save.mutate()}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
