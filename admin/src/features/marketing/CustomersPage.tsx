import { customerInputSchema, customerUpdateSchema } from "@restoflux/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Gift } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ActiveBadge, fmtDate, fmtDateTime } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor, useCurrencies } from "@/lib/money";
import { useInvalidate } from "@/lib/queries";

interface Customer { id: string; name: string; phone: string | null; email: string | null; notes: string | null; birthday: string | null; marketingOptIn: boolean; loyaltyPoints: number; createdAt: string; deletedAt: string | null }
interface Profile {
  customer: Customer; orderCount: number; spendByCurrency: Record<string, number>; averageOrderMinor: Record<string, number>; lastOrderAt: string | null;
  recentOrders: { id: string; number: string; placedAt: string; status: string; totalMinor: number; currencyCode: string; branch: string }[];
  ledger: { id: string; type: string; points: number; balanceAfter: number; note: string | null; createdAt: string }[];
  feedback: { id: string; rating: number; comment: string | null; createdAt: string }[];
}

/** People who have ordered or been added by staff. A customer is recognised by phone number, so entering it at the till links their orders. */
export default function CustomersPage() {
  const columns = useMemo<ColumnDef<Customer, any>[]>(
    () => [
      { accessorKey: "name", header: "Customer", meta: { sortKey: "name", label: "Customer" }, cell: ({ row }) => <div><div className="font-medium">{row.original.name}</div><div className="text-xs text-muted-foreground">{[row.original.phone, row.original.email].filter(Boolean).join(" · ")}</div></div> },
      { accessorKey: "loyaltyPoints", header: "Points", meta: { sortKey: "loyaltyPoints", label: "Points" }, cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
      { accessorKey: "marketingOptIn", header: "Marketing", meta: { label: "Marketing" }, cell: ({ getValue }) => <ActiveBadge active={getValue()} /> },
      { accessorKey: "createdAt", header: "Since", meta: { sortKey: "createdAt", label: "Since" }, cell: ({ getValue }) => <span className="text-muted-foreground">{fmtDate(getValue())}</span> },
    ],
    [],
  );
  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "phone", label: "Phone", type: "text", nullable: true, span: 1, hint: "How orders are matched to this person." },
      { name: "email", label: "Email", type: "email", nullable: true, span: 1 },
      { name: "birthday", label: "Birthday", type: "date", nullable: true, span: 1 },
      { name: "marketingOptIn", label: "Happy to receive offers", type: "switch" },
      { name: "notes", label: "Notes", type: "textarea", nullable: true, placeholder: "Allergies, favourite table…" },
    ],
    [],
  );
  return (
    <CrudPage<Customer>
      title="Customers" description="Everyone who has ordered with a phone number, plus people you add. Open one to see their history and points."
      entity="customer" path="/customers" columns={columns} defaultSort="name" fields={fields}
      createSchema={customerInputSchema} updateSchema={customerUpdateSchema}
      defaults={{ name: "", phone: "", email: "", birthday: "", marketingOptIn: false, notes: "" }}
      toForm={(r) => ({ ...r, phone: r.phone ?? "", email: r.email ?? "", birthday: r.birthday?.slice(0, 10) ?? "", notes: r.notes ?? "" })}
      writePermission="customers.manage" searchPlaceholder="Name, phone or email…" wide archivable={false} hardDelete={false}
      extraSections={(row) => <ProfilePanel id={row.id} />}
      emptyDescription="Customers appear here automatically when an order with a phone number is completed."
    />
  );
}

function ProfilePanel({ id }: { id: string }) {
  const { can } = useAuth();
  const { exponent } = useCurrencies();
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: ["/customers", "profile", id], queryFn: async () => (await api.get<{ data: Profile }>(`/customers/${id}/profile`)).data });
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");
  const [redeem, setRedeem] = useState("");
  const [issued, setIssued] = useState<{ code: string; valueMinor: number } | null>(null);
  const refresh = async () => { await invalidate("/customers"); await q.refetch(); };
  const adjust = useMutation({ mutationFn: () => api.post(`/customers/${id}/loyalty`, { points: Number(points), note: note.trim() }), onSuccess: async () => { toast.success("Points updated"); setPoints(""); setNote(""); await refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const redeemIt = useMutation({ mutationFn: async () => (await api.post<{ data: { code: string; valueMinor: number } }>(`/customers/${id}/redeem`, { points: Number(redeem) })).data, onSuccess: async (r) => { setIssued(r); setRedeem(""); await refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const p = q.data;
  if (!p) return <p className="mt-6 text-sm text-muted-foreground">Loading history…</p>;
  const fmt = (minor: number, cur: string) => formatMinor(minor, cur, exponent(cur));

  return (
    <div className="mt-6 space-y-4 border-t pt-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Orders" value={String(p.orderCount)} />
        <Stat label="Spent" value={Object.entries(p.spendByCurrency).map(([c, v]) => fmt(v, c)).join(" · ") || "-"} />
        <Stat label="Last order" value={p.lastOrderAt ? fmtDate(p.lastOrderAt) : "-"} />
        <Stat label="Points" value={String(p.customer.loyaltyPoints)} />
      </div>

      {can("loyalty.manage") && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="text-sm font-semibold">Adjust points</div>
          <div className="grid items-end gap-2 sm:grid-cols-[6rem_1fr_auto]">
            <div className="space-y-1"><Label htmlFor="adj-pts">Points</Label><Input id="adj-pts" inputMode="numeric" placeholder="+10 or -5" value={points} onChange={(e) => setPoints(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="adj-why">Why</Label><Input id="adj-why" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Birthday gift, correction…" /></div>
            <Button type="button" disabled={!Number(points) || !note.trim() || adjust.isPending} onClick={() => adjust.mutate()}>Apply</Button>
          </div>
        </div>
      )}
      {can("customers.manage") && p.customer.loyaltyPoints > 0 && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><Gift className="size-4" /> Redeem points</div>
          <div className="flex items-end gap-2"><div className="space-y-1"><Label htmlFor="rdm">Points to spend</Label><Input id="rdm" className="w-32" inputMode="numeric" value={redeem} onChange={(e) => setRedeem(e.target.value)} /></div><Button type="button" disabled={!Number(redeem) || redeemIt.isPending} onClick={() => redeemIt.mutate()}>Create coupon</Button></div>
          {issued && <p className="rounded-md bg-emerald-500/10 p-2 text-sm">Give them coupon <span className="font-mono font-semibold">{issued.code}</span> (usable once, with their phone number on the order).</p>}
        </div>
      )}

      <Section title="Recent orders">
        {p.recentOrders.length === 0 ? <p className="text-sm text-muted-foreground">No orders matched to this phone number yet.</p> : p.recentOrders.map((o) => <Row key={o.id} left={<><span className="font-medium">{o.number}</span> <span className="text-muted-foreground">· {o.branch} · {fmtDateTime(o.placedAt)}</span></>} right={<><Badge variant="secondary" className="mr-2">{o.status.toLowerCase()}</Badge><span className="tabular-nums">{fmt(o.totalMinor, o.currencyCode)}</span></>} />)}
      </Section>
      <Section title="Points history">
        {p.ledger.length === 0 ? <p className="text-sm text-muted-foreground">No points yet. Switch the loyalty programme on under Marketing &gt; Loyalty.</p> : p.ledger.map((l) => <Row key={l.id} left={<><span className="font-medium">{l.type === "EARN" ? "Earned" : l.type === "REDEEM" ? "Redeemed" : "Adjusted"}</span> <span className="text-muted-foreground">· {l.note ?? ""} · {fmtDate(l.createdAt)}</span></>} right={<span className={`tabular-nums ${l.points < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>{l.points > 0 ? "+" : ""}{l.points} <span className="text-xs text-muted-foreground">(balance {l.balanceAfter})</span></span>} />)}
      </Section>
      {p.feedback.length > 0 && <Section title="Feedback">{p.feedback.map((f) => <Row key={f.id} left={<span>{"★".repeat(f.rating)}{"☆".repeat(5 - f.rating)} <span className="text-muted-foreground">{f.comment}</span></span>} right={<span className="text-xs text-muted-foreground">{fmtDate(f.createdAt)}</span>} />)}</Section>}
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-0.5 font-semibold tabular-nums">{value}</div></div>;
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => <div><h3 className="mb-1 text-sm font-semibold">{title}</h3><div className="divide-y rounded-lg border">{children}</div></div>;
const Row = ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span>{left}</span><span className="shrink-0">{right}</span></div>;
