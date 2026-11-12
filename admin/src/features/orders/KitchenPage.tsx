import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, ChefHat, ShoppingBag, Utensils } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page/PageHeader";
import { EmptyState, ErrorState } from "@/components/page/states";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/features/menu/shared";
import { api, errorMessage } from "@/lib/api";
import { TYPE_LABEL, useBranches, useMinutesSince } from "./common";

// THE KITCHEN DISPLAY. Each ticket is an order the kitchen has been sent. A cook taps an item when they start it
// and again when it is ready; "All ready" bumps the whole ticket. Choose a station (grill, fryer, bar) to see
// only that station's items. Tickets turn amber after 10 minutes and red after 20.

interface Ticket {
  orderId: string; orderNumber: string; orderType: string; channel: string; status: string; table: string | null; customerName: string | null; notes: string | null; placedAt: string;
  lines: { id: string; name: string; variantName: string | null; quantity: number; notes: string | null; status: string; stationKey: string | null; partOf: string | null; modifiers: string[] }[];
}
const ICON = { DINE_IN: Utensils, TAKEAWAY: ShoppingBag, DELIVERY: Bike } as const;

function TicketCard({ t, onLine, onBump, busy }: { t: Ticket; onLine: (lineId: string, status: "PREPARING" | "READY") => void; onBump: (orderId: string) => void; busy: boolean }) {
  const minutes = useMinutesSince(t.placedAt);
  const tone = minutes >= 20 ? "border-red-500 bg-red-500/10" : minutes >= 10 ? "border-amber-500 bg-amber-500/10" : "border-border bg-card";
  const Icon = ICON[t.orderType as keyof typeof ICON] ?? ShoppingBag;
  return (
    <li className={`flex flex-col rounded-xl border-2 p-3 shadow-sm ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <div><div className="flex items-center gap-1.5 text-lg font-bold"><Icon className="size-4" /> {t.orderNumber}</div><div className="text-xs text-muted-foreground">{TYPE_LABEL[t.orderType]}{t.table ? ` · Table ${t.table}` : ""}{t.customerName ? ` · ${t.customerName}` : ""}</div></div>
        <span className="text-lg font-bold tabular-nums">{minutes}<span className="text-xs font-normal">m</span></span>
      </div>
      {t.notes && <div className="mt-1 rounded bg-amber-400/20 px-2 py-1 text-sm font-medium">{t.notes}</div>}
      <ul className="mt-2 flex-1 space-y-1">
        {t.lines.map((l) => {
          const next = l.status === "NEW" ? "PREPARING" : l.status === "PREPARING" ? "READY" : null;
          return (
            <li key={l.id}>
              <button type="button" disabled={!next || busy} onClick={() => next && onLine(l.id, next)} aria-label={`${l.quantity} ${l.name}: ${l.status.toLowerCase()}${next ? `, mark ${next.toLowerCase()}` : ""}`}
                className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-base transition-colors ${l.status === "READY" ? "bg-emerald-500/15 text-muted-foreground line-through" : l.status === "PREPARING" ? "bg-violet-500/15" : "hover:bg-accent"}`}>
                <span className="min-w-6 font-bold tabular-nums">{l.quantity}×</span>
                <span className="min-w-0 flex-1"><span className="font-medium">{l.name}</span>{l.variantName && <span className="text-muted-foreground"> ({l.variantName})</span>}
                  {l.partOf && <span className="ml-1 text-xs text-muted-foreground">· {l.partOf}</span>}
                  {l.modifiers.length > 0 && <span className="block text-sm text-muted-foreground">+ {l.modifiers.join(", ")}</span>}
                  {l.notes && <span className="block text-sm font-medium text-amber-700 dark:text-amber-400">“{l.notes}”</span>}</span>
                <span className="text-xs uppercase text-muted-foreground">{l.status === "NEW" ? "" : l.status.toLowerCase()}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button className="mt-2" disabled={busy} onClick={() => onBump(t.orderId)}>All ready</Button>
    </li>
  );
}

export default function KitchenPage() {
  const qc = useQueryClient();
  const branches = useBranches();
  const [locationId, setLocationId] = useState("");
  const [station, setStation] = useState("");
  useEffect(() => { if (!locationId && branches[0]) setLocationId(branches[0].id); }, [branches, locationId]);

  const tickets = useQuery({
    queryKey: ["/kds", locationId, station], enabled: !!locationId, refetchInterval: 5_000,
    queryFn: async () => (await api.get<{ data: Ticket[] }>("/kds", { locationId, ...(station ? { station } : {}) })).data,
  });
  // stations are discovered from what is on the screen (a cook has no access to the setup screens)
  const all = useQuery({ queryKey: ["/kds", locationId, "stations"], enabled: !!locationId, refetchInterval: 15_000, queryFn: async () => (await api.get<{ data: Ticket[] }>("/kds", { locationId })).data });
  const stations = [...new Set((all.data ?? []).flatMap((t) => t.lines.map((l) => l.stationKey)).filter((s): s is string => !!s))].sort();

  const refresh = () => void qc.invalidateQueries({ queryKey: ["/kds"] });
  const line = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/kds/lines/${id}`, { status }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const bump = useMutation({ mutationFn: (orderId: string) => api.post(`/kds/orders/${orderId}/ready`, station ? { station } : {}), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });

  return (
    <>
      <PageHeader title="Kitchen display" description="Orders waiting to be cooked. Tap an item to start it, tap again when it is ready." actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-52"><SimpleSelect value={locationId} onChange={(v) => { setLocationId(v); setStation(""); }} options={branches.map((b) => ({ value: b.id, label: b.name }))} label="Branch" /></div>
        </div>
      } />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Station">
        <Button size="sm" variant={station === "" ? "default" : "outline"} onClick={() => setStation("")}>All stations</Button>
        {stations.map((s) => <Button key={s} size="sm" variant={station === s ? "default" : "outline"} onClick={() => setStation(s)}>{s}</Button>)}
      </div>
      {tickets.isError ? <ErrorState message={errorMessage(tickets.error)} onRetry={() => void tickets.refetch()} /> : (tickets.data ?? []).length === 0 ? (
        <EmptyState icon={<ChefHat className="size-8" />} title="No orders waiting" description="New orders appear here as soon as the till sends them." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {(tickets.data ?? []).map((t) => <TicketCard key={t.orderId} t={t} busy={line.isPending || bump.isPending} onLine={(id, status) => line.mutate({ id, status })} onBump={(id) => bump.mutate(id)} />)}
        </ul>
      )}
    </>
  );
}
