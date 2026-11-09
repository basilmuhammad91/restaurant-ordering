import { useInfiniteQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { fmtDateTime, Mono } from "@/components/cells";
import { PageHeader } from "@/components/page/PageHeader";
import { EmptyState, ErrorState, LoadingRows } from "@/components/page/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage, type Cursored } from "@/lib/api";
import { useScope } from "@/lib/scope";

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  requestId: string | null;
  ip: string | null;
  occurredAt: string;
  locationId: string | null;
  actorType: string;
  actor: { id: string; name: string; email: string } | null;
}

const MODULES = [
  { value: "brands.", label: "Brands" }, { value: "locations.", label: "Branches & warehouses" }, { value: "users.", label: "Users" },
  { value: "roles.", label: "Roles & permissions" }, { value: "tax-", label: "Taxes" }, { value: "payment-methods.", label: "Payment methods" },
  { value: "approvals.", label: "Approvals" }, { value: "tenant.", label: "Company settings" }, { value: "auth.", label: "Sign-in" },
];

const tone = (action: string) => (/\.(archive|delete|disable|revoke|reject)$/.test(action) ? "destructive" : /\.(create|approve)$/.test(action) ? "default" : "secondary");

/** Which top-level fields changed between two snapshots. */
function changes(before: unknown, after: unknown): { key: string; from: unknown; to: unknown }[] {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !["updatedAt", "createdAt"].includes(k));
  return keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).map((k) => ({ key: k, from: b[k], to: a[k] }));
}
const show = (v: unknown) => (v === undefined ? "-" : typeof v === "string" ? v : JSON.stringify(v));

export default function AuditLogPage() {
  const { range } = useScope();
  const [prefix, setPrefix] = useState("");
  const [open, setOpen] = useState<AuditRow | null>(null);

  const from = new Date(`${range.from}T00:00:00`).toISOString();
  const to = new Date(`${range.to}T23:59:59.999`).toISOString();

  const q = useInfiniteQuery({
    queryKey: ["/audit-logs", prefix, from, to],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<Cursored<AuditRow>>("/audit-logs", { limit: 50, cursor: pageParam, actionPrefix: prefix || undefined, from, to }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageHeader title="Audit log" description="Who did what, when and where. Entries cannot be edited or deleted. Uses the date range in the top bar." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={prefix || "__all__"} onValueChange={(v) => setPrefix(v === "__all__" ? "" : v)}>
          <SelectTrigger size="sm" className="w-56" aria-label="Area"><SelectValue placeholder="All areas" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All areas</SelectItem>
            {MODULES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>Refresh</Button>
      </div>

      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.isPending ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="size-8" />} title="No activity in this period" description="Try a wider date range in the top bar." />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead><TableHead>Who</TableHead><TableHead>Action</TableHead><TableHead>Record</TableHead><TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpen(r)}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.occurredAt)}</TableCell>
                    <TableCell>{r.actor?.name ?? (r.actorType === "SYSTEM" ? "System" : "Unknown")}</TableCell>
                    <TableCell><Badge variant={tone(r.action) as "default"}>{r.action}</Badge></TableCell>
                    <TableCell><span className="text-muted-foreground">{r.entityType}</span> <Mono>{r.entityId.slice(0, 8)}</Mono></TableCell>
                    <TableCell className="text-right text-xs text-primary">Details</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex justify-center">
            {q.hasNextPage ? <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage ? "Loading…" : "Load more"}</Button> : <span className="text-sm text-muted-foreground">End of the log</span>}
          </div>
        </>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.action}</DialogTitle>
                <DialogDescription>{fmtDateTime(open.occurredAt)} · {open.actor ? `${open.actor.name} (${open.actor.email})` : open.actorType}</DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Record</dt><dd>{open.entityType} <Mono>{open.entityId}</Mono></dd>
                {open.reason && (<><dt className="text-muted-foreground">Reason</dt><dd>{open.reason}</dd></>)}
                {open.ip && (<><dt className="text-muted-foreground">IP address</dt><dd>{open.ip}</dd></>)}
                {open.requestId && (<><dt className="text-muted-foreground">Request</dt><dd><Mono>{open.requestId}</Mono></dd></>)}
              </dl>
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Changes</h4>
                {changes(open.before, open.after).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No field-level changes recorded.</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border text-sm">
                    <Table>
                      <TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Before</TableHead><TableHead>After</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {changes(open.before, open.after).map((c) => (
                          <TableRow key={c.key}>
                            <TableCell className="font-medium">{c.key}</TableCell>
                            <TableCell className="max-w-48 break-words text-red-700 dark:text-red-400">{show(c.from)}</TableCell>
                            <TableCell className="max-w-48 break-words text-emerald-700 dark:text-emerald-400">{show(c.to)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
