import { useInfiniteQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { Link } from "react-router";
import { fmtDateTime } from "@/components/cells";
import { PageHeader } from "@/components/page/PageHeader";
import { EmptyState, ErrorState, LoadingRows } from "@/components/page/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage, platformApi, type Cursored } from "@/lib/api";

interface Row {
  id: string;
  action: string;
  entityType: string;
  reason: string | null;
  occurredAt: string;
  tenantId: string | null;
  actorName: string | null;
  organizationName: string | null;
}

/** Everything the Restoflux team did to organizations and to the team itself. Entries cannot be edited or deleted. */
export default function PlatformAuditPage() {
  const q = useInfiniteQuery({
    queryKey: ["/platform/audit-logs"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => platformApi.get<Cursored<Row>>("/audit-logs", { limit: 50, cursor: pageParam }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageHeader title="Platform audit" description="Every action the Restoflux team has taken on organizations. Entries cannot be edited or deleted." />
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.isPending ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-8" />} title="Nothing recorded yet" description="Creating, suspending or changing an organization appears here." />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Who</TableHead><TableHead>Action</TableHead><TableHead>Organization</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.occurredAt)}</TableCell>
                    <TableCell>{r.actorName ?? "Unknown"}</TableCell>
                    <TableCell><Badge variant="secondary">{r.action}</Badge></TableCell>
                    <TableCell>{r.tenantId ? <Link to={`/platform/organizations/${r.tenantId}`} className="text-primary hover:underline">{r.organizationName ?? "Deleted organization"}</Link> : <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">{r.reason ?? "-"}</TableCell>
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
    </>
  );
}
