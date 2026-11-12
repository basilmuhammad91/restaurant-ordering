import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Copy, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page/PageHeader";
import { ErrorState } from "@/components/page/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { LocationSelect } from "@/features/inventory/shared";
import { SimpleSelect } from "@/features/menu/shared";
import { useBranches } from "@/features/orders/common";
import { api, errorMessage, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useInvalidate } from "@/lib/queries";

interface Shift { id: string; employeeId: string; employeeName: string; shiftDate: string; startTime: string; endTime: string; position: string | null; note: string | null }
interface Emp { id: string; name: string; position: string | null; locationId: string | null }

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86_400_000));
const mondayOf = (s: string) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return iso(d); };
const hoursOf = (s: Shift) => { const a = Number(s.startTime.slice(0, 2)) * 60 + Number(s.startTime.slice(3)); let b = Number(s.endTime.slice(0, 2)) * 60 + Number(s.endTime.slice(3)); if (b <= a) b += 1440; return (b - a) / 60; };

/** Who works when, one week at a time. Click a shift to remove it. */
export default function RosterPage() {
  const { can } = useAuth();
  const branches = useBranches();
  const invalidate = useInvalidate();
  const [locationId, setLocationId] = useState("");
  const branch = locationId || branches[0]?.id || "";
  const [weekStart, setWeekStart] = useState(() => mondayOf(iso(new Date())));
  const [adding, setAdding] = useState<string | null>(null);
  const edit = can("roster.manage");
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const q = useQuery({ queryKey: ["/roster", branch, weekStart], enabled: !!branch, queryFn: async () => (await api.get<{ data: Shift[] }>("/roster", { from: weekStart, to: addDays(weekStart, 6), locationId: branch })).data });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/roster/${id}`), onSuccess: async () => { await invalidate("/roster"); }, onError: (e) => toast.error(errorMessage(e)) });
  const copy = useMutation({
    mutationFn: async () => (await api.post<{ data: { copied: number; skipped: number } }>("/roster/copy-week", { locationId: branch, fromWeekStart: weekStart, toWeekStart: addDays(weekStart, 7) })).data,
    onSuccess: async (r) => { toast.success(`Copied ${r.copied} shift${r.copied === 1 ? "" : "s"} to next week${r.skipped ? ` (${r.skipped} skipped)` : ""}`); await invalidate("/roster"); setWeekStart(addDays(weekStart, 7)); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const byPerson = new Map<string, { name: string; hours: number; cells: Map<string, Shift[]> }>();
  for (const s of q.data ?? []) {
    const p = byPerson.get(s.employeeId) ?? { name: s.employeeName, hours: 0, cells: new Map() };
    p.hours += hoursOf(s); p.cells.set(s.shiftDate, [...(p.cells.get(s.shiftDate) ?? []), s]); byPerson.set(s.employeeId, p);
  }
  const people = [...byPerson.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="Roster" description="The week's shifts for one branch."
        actions={<div className="flex flex-wrap items-center gap-2"><LocationSelect value={branch} onChange={setLocationId} locations={branches} label="Branch" />
          {edit && <Button variant="outline" disabled={!branch || copy.isPending || (q.data ?? []).length === 0} onClick={() => copy.mutate()}><Copy /> Copy to next week</Button>}
          {edit && <Button disabled={!branch} onClick={() => setAdding(week[0]!)}><Plus /> Add shift</Button>}</div>} />
      <div className="mb-3 flex items-center gap-2">
        <Button size="icon" variant="outline" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft /></Button>
        <span className="min-w-48 text-center text-sm font-medium">Week of {weekStart}</span>
        <Button size="icon" variant="outline" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight /></Button>
        <Button size="sm" variant="ghost" onClick={() => setWeekStart(mondayOf(iso(new Date())))}>This week</Button>
      </div>
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[56rem] text-sm">
            <thead><tr className="border-b text-left"><th className="w-40 px-3 py-2 font-medium">Person</th>{week.map((d, i) => <th key={d} className="px-2 py-2 font-medium"><div>{DAYS[i]}</div><div className="text-xs font-normal text-muted-foreground">{d.slice(5)}</div></th>)}<th className="w-20 px-3 py-2 text-right font-medium">Hours</th></tr></thead>
            <tbody>
              {q.isPending ? <tr><td colSpan={9} className="p-4"><Skeleton className="h-8 w-full" /></td></tr>
                : people.length === 0 ? <tr><td colSpan={9} className="py-10 text-center text-muted-foreground">No shifts this week. Add one, or copy a previous week.</td></tr>
                : people.map(([id, p]) => (
                  <tr key={id} className="border-b last:border-0 align-top">
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    {week.map((d) => (
                      <td key={d} className="px-1.5 py-1.5">
                        {(p.cells.get(d) ?? []).map((s) => <button key={s.id} type="button" disabled={!edit} title={edit ? "Click to remove" : undefined} onClick={() => edit && remove.mutate(s.id)} className="mb-1 block w-full rounded-md bg-primary/10 px-1.5 py-1 text-left text-xs text-primary hover:bg-primary/20 disabled:cursor-default"><span className="font-medium tabular-nums">{s.startTime}-{s.endTime}</span>{s.position && <span className="block truncate text-[11px] opacity-80">{s.position}</span>}</button>)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums">{Math.round(p.hours * 10) / 10}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddShift branch={branch} week={week} initialDate={adding} onClose={() => setAdding(null)} />}
    </>
  );
}

function AddShift({ branch, week, initialDate, onClose }: { branch: string; week: string[]; initialDate: string; onClose: () => void }) {
  const invalidate = useInvalidate();
  const emps = useQuery({ queryKey: ["/employees", "active"], queryFn: async () => (await api.get<Paged<Emp>>("/employees", { isActive: true, pageSize: 100 })).data });
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("18:00");
  const [position, setPosition] = useState("");
  const save = useMutation({
    mutationFn: () => api.post("/roster", { employeeId, locationId: branch, shiftDate: date, startTime: start, endTime: end, position: position.trim() || null }),
    onSuccess: async () => { toast.success("Shift added"); await invalidate("/roster"); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const chosen = emps.data?.find((e) => e.id === employeeId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add a shift</DialogTitle><DialogDescription>An end time earlier than the start means the shift runs past midnight.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label>Person</Label><SimpleSelect value={employeeId} onChange={(v) => { setEmployeeId(v); const p = emps.data?.find((e) => e.id === v)?.position; if (p && !position) setPosition(p); }} label="Person" options={(emps.data ?? []).map((e) => ({ value: e.id, label: e.name }))} placeholder={emps.data?.length === 0 ? "Add employees first" : "Choose…"} /></div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label>Day</Label><SimpleSelect value={date} onChange={setDate} label="Day" options={week.map((d, i) => ({ value: d, label: `${DAYS[i]} ${d.slice(5)}` }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="sh-start">From</Label><Input id="sh-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="sh-end">Until</Label><Input id="sh-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="sh-pos">Role for this shift</Label><Input id="sh-pos" value={position} onChange={(e) => setPosition(e.target.value)} placeholder={chosen?.position ?? "Floor, Grill, Cashier…"} /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!employeeId || !start || !end || save.isPending} onClick={() => save.mutate()}>Add shift</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
