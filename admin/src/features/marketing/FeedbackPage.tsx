import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { MessageSquarePlus, Star } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmtDateTime } from "@/components/cells";
import { DataTable } from "@/components/data-table/DataTable";
import { useTableState } from "@/components/data-table/useTableState";
import { Bars, Tile } from "@/components/page/charts";
import { PageHeader } from "@/components/page/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/features/menu/shared";
import { useBranches } from "@/features/orders/common";
import { api, errorMessage } from "@/lib/api";
import { useInvalidate, useList } from "@/lib/queries";

interface Row { id: string; rating: number; comment: string | null; status: "NEW" | "REPLIED" | "RESOLVED"; reply: string | null; source: string; createdAt: string; locationName: string; customerName: string | null; customerPhone: string | null }
interface Summary { total: number; average: number | null; distribution: { rating: number; count: number }[]; newCount: number }

const Stars = ({ n }: { n: number }) => <span className="whitespace-nowrap text-amber-500" aria-label={`${n} out of 5`}>{"★".repeat(n)}<span className="text-muted-foreground/40">{"★".repeat(5 - n)}</span></span>;
const STATUS_TONE = { NEW: "bg-amber-500/15 text-amber-700 dark:text-amber-400", REPLIED: "bg-sky-500/15 text-sky-700 dark:text-sky-400", RESOLVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" };

/** What guests say. Record it as it comes in (a comment card, a call), answer it, and watch the average. */
export default function FeedbackPage() {
  const branches = useBranches();
  const { state, update } = useTableState("-createdAt", ["locationId", "status", "maxRating"]);
  const list = useList<Row>("/feedback", state);
  const summary = useQuery({ queryKey: ["/feedback", "summary", state.filters.locationId], queryFn: async () => (await api.get<{ data: Summary }>("/feedback/summary", state.filters.locationId ? { locationId: state.filters.locationId } : {})).data });
  const [open, setOpen] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const s = summary.data;

  const columns: ColumnDef<Row, any>[] = [
    { accessorKey: "rating", header: "Rating", meta: { label: "Rating" }, cell: ({ getValue }) => <Stars n={getValue()} /> },
    { accessorKey: "comment", header: "Comment", meta: { label: "Comment" }, cell: ({ row }) => <div className="max-w-md"><div className="truncate">{row.original.comment ?? <span className="text-muted-foreground">No comment</span>}</div>{row.original.reply && <div className="truncate text-xs text-muted-foreground">Reply: {row.original.reply}</div>}</div> },
    { id: "who", header: "From", meta: { label: "From" }, cell: ({ row }) => <div className="text-sm"><div>{row.original.customerName ?? "Anonymous"}</div><div className="text-xs text-muted-foreground">{row.original.locationName}</div></div> },
    { accessorKey: "createdAt", header: "When", meta: { sortKey: "createdAt", label: "When" }, cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(getValue())}</span> },
    { accessorKey: "status", header: "Status", meta: { label: "Status" }, cell: ({ getValue }) => <Badge variant="secondary" className={STATUS_TONE[getValue() as Row["status"]]}>{(getValue() as string).charAt(0) + (getValue() as string).slice(1).toLowerCase()}</Badge> },
  ];

  return (
    <>
      <PageHeader title="Feedback" description="Ratings and comments from guests." actions={<Button onClick={() => setAdding(true)}><MessageSquarePlus /> Add feedback</Button>} />
      <div className="mb-4 grid gap-4 lg:grid-cols-4">
        <Tile label="Average rating" value={s?.average ? `${s.average} / 5` : "-"} hint={s ? `${s.total} responses` : undefined} tone={s?.average && s.average >= 4 ? "good" : s?.average && s.average < 3 ? "bad" : undefined} />
        <Tile label="Waiting for a reply" value={String(s?.newCount ?? 0)} tone={s?.newCount ? "bad" : undefined} />
        <Card className="lg:col-span-2"><CardHeader className="pb-2"><CardTitle className="text-base">Ratings</CardTitle></CardHeader><CardContent><Bars rows={[5, 4, 3, 2, 1].map((r) => ({ label: `${r} star${r === 1 ? "" : "s"}`, value: s?.distribution.find((d) => d.rating === r)?.count ?? 0 }))} format={(n) => String(n)} /></CardContent></Card>
      </div>
      <DataTable columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update} loading={list.isFetching}
        error={list.isError ? errorMessage(list.error) : null} onRetry={() => void list.refetch()} getRowId={(r) => r.id} onRowClick={(r) => setOpen(r)} hideSearch
        filters={<>
          <SimpleSelect className="w-44" allowEmpty emptyLabel="All branches" value={state.filters.locationId ?? ""} onChange={(v) => update({ filters: { locationId: v || undefined } })} label="Branch" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          <SimpleSelect className="w-40" allowEmpty emptyLabel="Any status" value={state.filters.status ?? ""} onChange={(v) => update({ filters: { status: v || undefined } })} label="Status" options={["NEW", "REPLIED", "RESOLVED"].map((x) => ({ value: x, label: x.charAt(0) + x.slice(1).toLowerCase() }))} />
          <SimpleSelect className="w-40" allowEmpty emptyLabel="Any rating" value={state.filters.maxRating ?? ""} onChange={(v) => update({ filters: { maxRating: v || undefined } })} label="Rating" options={[{ value: "2", label: "2 stars or less" }, { value: "3", label: "3 stars or less" }]} />
        </>}
        emptyTitle="No feedback yet" emptyDescription="Record what guests tell you, or ask for a rating when you hand over the bill." />
      {open && <ReplyDialog row={open} onClose={() => setOpen(null)} />}
      {adding && <AddDialog onClose={() => setAdding(false)} />}
    </>
  );
}

function ReplyDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [reply, setReply] = useState(row.reply ?? "");
  const done = async (msg: string) => { toast.success(msg); await invalidate("/feedback"); onClose(); };
  const send = useMutation({ mutationFn: () => api.post(`/feedback/${row.id}/reply`, { reply: reply.trim() }), onSuccess: () => done("Reply saved"), onError: (e) => toast.error(errorMessage(e)) });
  const resolve = useMutation({ mutationFn: () => api.post(`/feedback/${row.id}/resolve`, {}), onSuccess: () => done("Marked as resolved"), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle><Stars n={row.rating} /> {row.customerName ?? "Anonymous"}</DialogTitle><DialogDescription>{row.locationName} · {fmtDateTime(row.createdAt)} · {row.source.toLowerCase()}</DialogDescription></DialogHeader>
        <p className="rounded-lg bg-muted p-3 text-sm">{row.comment ?? "No comment left."}</p>
        <div className="space-y-1.5"><Label htmlFor="fb-reply">Your reply (kept on record)</Label><Textarea id="fb-reply" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} /></div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" disabled={row.status === "RESOLVED" || resolve.isPending} onClick={() => resolve.mutate()}>Mark resolved</Button>
          <div className="flex gap-2"><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={!reply.trim() || send.isPending} onClick={() => send.mutate()}>Save reply</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddDialog({ onClose }: { onClose: () => void }) {
  const branches = useBranches();
  const invalidate = useInvalidate();
  const [locationId, setLocationId] = useState(branches[0]?.id ?? "");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const save = useMutation({
    mutationFn: () => api.post("/feedback", { locationId, rating, comment: comment.trim() || null }),
    onSuccess: async () => { toast.success("Feedback recorded"); await invalidate("/feedback"); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add feedback</DialogTitle><DialogDescription>Write down what a guest told you.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label>Branch</Label><SimpleSelect value={locationId} onChange={setLocationId} label="Branch" options={branches.map((b) => ({ value: b.id, label: b.name }))} /></div>
        <div className="space-y-1.5"><Label>Rating</Label><div className="flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} stars`} onClick={() => setRating(n)}><Star className={`size-8 ${n <= rating ? "fill-amber-400 text-amber-500" : "text-muted-foreground/40"}`} /></button>)}</div></div>
        <div className="space-y-1.5"><Label htmlFor="fb-comment">Comment</Label><Textarea id="fb-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!rating || !locationId || save.isPending} onClick={() => save.mutate()}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
