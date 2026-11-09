import { LOCATION_TYPES, locationInputSchema, locationUpdateSchema } from "@restoflux/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Mono, titleCase } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useCurrencies } from "@/lib/money";
import { useAll, useInvalidate } from "@/lib/queries";

interface Location {
  id: string;
  type: (typeof LOCATION_TYPES)[number];
  code: string;
  name: string;
  brandId: string | null;
  brand: { id: string; name: string } | null;
  city: string | null;
  countryCode: string;
  timezone: string;
  currencyCode: string;
  taxProfileId: string | null;
  priceBookId: string | null;
  deletedAt: string | null;
}

const typeLabel = { BRANCH: "Branch", WAREHOUSE: "Warehouse", CENTRAL_KITCHEN: "Central kitchen" } as const;
const typeOptions = LOCATION_TYPES.map((t) => ({ value: t, label: typeLabel[t] }));

const columns: ColumnDef<Location, any>[] = [
  {
    accessorKey: "name", header: "Name", meta: { sortKey: "name", label: "Name" },
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.name}</div>
        <Mono>{row.original.code}</Mono>
      </div>
    ),
  },
  { accessorKey: "type", header: "Type", meta: { sortKey: "type", label: "Type" }, cell: ({ getValue }) => <Badge variant="outline">{typeLabel[getValue() as keyof typeof typeLabel]}</Badge> },
  { id: "brand", header: "Brand", meta: { label: "Brand" }, accessorFn: (r) => r.brand?.name ?? "-" },
  { id: "place", header: "City", meta: { label: "City" }, accessorFn: (r) => [r.city, r.countryCode].filter(Boolean).join(", ") },
  { accessorKey: "currencyCode", header: "Currency", cell: ({ getValue }) => <Mono>{getValue()}</Mono> },
  { accessorKey: "timezone", header: "Timezone", cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span> },
];

// ---- opening hours ----
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
interface Hour { weekday: number; opensAt: string; closesAt: string }

function OpeningHoursEditor({ locationId }: { locationId: string }) {
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: ["/locations", "hours", locationId], queryFn: async () => (await api.get<{ data: Hour[] }>(`/locations/${locationId}/opening-hours`)).data });
  const [rows, setRows] = useState<Hour[] | null>(null);
  const current = rows ?? q.data?.map(({ weekday, opensAt, closesAt }) => ({ weekday, opensAt, closesAt })) ?? [];

  const save = useMutation({
    mutationFn: () => api.put(`/locations/${locationId}/opening-hours`, { hours: current }),
    onSuccess: async () => { toast.success("Opening hours saved"); setRows(null); await invalidate("/locations"); },
    onError: (e) => toast.error(e instanceof ApiError && e.status === 422 ? "Two ranges start at the same time on the same day." : errorMessage(e)),
  });
  const set = (next: Hour[]) => setRows(next);

  return (
    <section className="space-y-3 border-t pt-4">
      <div>
        <h3 className="font-semibold">Opening hours</h3>
        <p className="text-sm text-muted-foreground">Local time at this branch. A closing time earlier than the opening time means the branch closes after midnight.</p>
      </div>
      {current.length === 0 && <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">No opening hours set.</p>}
      {current.map((h, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
          <Select value={String(h.weekday)} onValueChange={(v) => set(current.map((x, idx) => (idx === i ? { ...x, weekday: Number(v) } : x)))}>
            <SelectTrigger className="w-full" size="sm" aria-label="Day"><SelectValue /></SelectTrigger>
            <SelectContent>{DAYS.map((d, n) => <SelectItem key={d} value={String(n)}>{d}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="time" className="w-28" aria-label="Opens" value={h.opensAt} onChange={(e) => set(current.map((x, idx) => (idx === i ? { ...x, opensAt: e.target.value } : x)))} />
          <Input type="time" className="w-28" aria-label="Closes" value={h.closesAt} onChange={(e) => set(current.map((x, idx) => (idx === i ? { ...x, closesAt: e.target.value } : x)))} />
          <Button variant="ghost" size="icon" className="size-8 text-destructive" aria-label="Remove range" onClick={() => set(current.filter((_, idx) => idx !== i))}><Trash2 /></Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => set([...current, { weekday: 1, opensAt: "11:00", closesAt: "23:00" }])}><Plus /> Add range</Button>
        <Button variant="outline" size="sm" onClick={() => set([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: current[0]?.opensAt ?? "11:00", closesAt: current[0]?.closesAt ?? "23:00" })))}>Same every day</Button>
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || rows === null}>{save.isPending ? "Saving…" : "Save hours"}</Button>
      </div>
    </section>
  );
}

// ---- payment methods accepted at this branch ----
interface Method { id: string; name: string; type: string; isActive: boolean }
interface Link { paymentMethodId: string; isEnabled: boolean; sortOrder: number }

function PaymentMethodsEditor({ locationId }: { locationId: string }) {
  const methods = useAll<Method>("/payment-methods");
  const links = useQuery({ queryKey: ["/locations", "payment-methods", locationId], queryFn: async () => (await api.get<{ data: Link[] }>(`/locations/${locationId}/payment-methods`)).data });
  const [enabled, setEnabled] = useState<Set<string> | null>(null);
  const current = enabled ?? new Set((links.data ?? []).filter((l) => l.isEnabled).map((l) => l.paymentMethodId));

  const save = useMutation({
    mutationFn: () => api.put(`/locations/${locationId}/payment-methods`, { methods: [...current].map((paymentMethodId, sortOrder) => ({ paymentMethodId, isEnabled: true, sortOrder })) }),
    onSuccess: () => { toast.success("Payment methods saved"); setEnabled(null); void links.refetch(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <section className="space-y-3 border-t pt-4">
      <div>
        <h3 className="font-semibold">Payment methods accepted here</h3>
        <p className="text-sm text-muted-foreground">Only the methods switched on can be used at this branch's till.</p>
      </div>
      <div className="space-y-1">
        {(methods.data ?? []).filter((m) => m.isActive).map((m) => (
          <label key={m.id} className="flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm">
            <span>{m.name} <span className="text-xs text-muted-foreground">{titleCase(m.type)}</span></span>
            <Switch checked={current.has(m.id)} onCheckedChange={(c) => { const next = new Set(current); if (c) next.add(m.id); else next.delete(m.id); setEnabled(next); }} />
          </label>
        ))}
      </div>
      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || enabled === null}>{save.isPending ? "Saving…" : "Save payment methods"}</Button>
    </section>
  );
}

export default function LocationsPage() {
  const brands = useAll<{ id: string; name: string }>("/brands");
  const taxProfiles = useAll<{ id: string; name: string }>("/tax-profiles");
  const priceBooks = useAll<{ id: string; name: string; currencyCode: string }>("/price-books");
  const { currencies } = useCurrencies();

  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "type", label: "Type", type: "select", options: typeOptions, required: true, span: 1, hint: "Only branches sell; warehouses and central kitchens hold stock.", disabledWhen: (editing) => editing },
      { name: "brandId", label: "Brand", type: "select", allowEmpty: true, span: 1, options: (brands.data ?? []).map((b) => ({ value: b.id, label: b.name })), hint: "Required for a branch." },
      { name: "name", label: "Name", type: "text", required: true, span: 1, placeholder: "Smash & Co: Clifton" },
      { name: "code", label: "Code", type: "text", required: true, span: 1, placeholder: "KHI-01", hint: "Short and unique, e.g. KHI-01." },
      { name: "countryCode", label: "Country (2 letters)", type: "text", required: true, span: 1, placeholder: "PK" },
      { name: "city", label: "City", type: "text", nullable: true, span: 1 },
      { name: "address", label: "Address", type: "text", nullable: true },
      { name: "phone", label: "Phone", type: "text", nullable: true, span: 1 },
      { name: "timezone", label: "Timezone", type: "text", required: true, span: 1, placeholder: "Asia/Karachi", hint: "IANA name. Decides the trading day for reports." },
      { name: "currencyCode", label: "Currency", type: "select", required: true, span: 1, options: currencies.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` })) },
      { name: "businessDayStartTime", label: "Trading day starts at", type: "text", span: 1, placeholder: "05:00", hint: "A bar open until 2 am trades on yesterday's date." },
      { name: "taxProfileId", label: "Tax profile", type: "select", allowEmpty: true, span: 1, options: (taxProfiles.data ?? []).map((t) => ({ value: t.id, label: t.name })) },
      { name: "priceBookId", label: "Price book", type: "select", allowEmpty: true, span: 1, options: (priceBooks.data ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.currencyCode})` })), hint: "Must match the currency." },
      { name: "orderPrefix", label: "Order number prefix", type: "text", nullable: true, span: 1, placeholder: "KH" },
      { name: "receiptHeader", label: "Receipt header", type: "textarea", nullable: true },
      { name: "receiptFooter", label: "Receipt footer", type: "textarea", nullable: true, placeholder: "Thank you for dining with us!" },
      { name: "acceptsOnlineOrders", label: "Accepts online orders", type: "switch" },
      { name: "isActive", label: "Active", type: "switch" },
    ],
    [brands.data, taxProfiles.data, priceBooks.data, currencies],
  );

  return (
    <CrudPage<Location>
      title="Branches & warehouses" description="Every place that sells or stores stock, each with its own currency, timezone, tax profile and opening hours." entity="location" path="/locations"
      columns={columns} defaultSort="name" fields={fields} createSchema={locationInputSchema} updateSchema={locationUpdateSchema}
      defaults={{ type: "BRANCH", brandId: null, name: "", code: "", countryCode: "PK", city: "", address: "", phone: "", timezone: "Asia/Karachi", currencyCode: "PKR", businessDayStartTime: "05:00", taxProfileId: null, priceBookId: null, orderPrefix: "", receiptHeader: "", receiptFooter: "", acceptsOnlineOrders: false, isActive: true }}
      writePermission="locations.manage" wide
      filters={[{ key: "type", label: "Type", options: typeOptions }]}
      extraSections={(row) => (
        <>
          <OpeningHoursEditor key={`h-${row.id}`} locationId={row.id} />
          <PaymentMethodsEditor key={`p-${row.id}`} locationId={row.id} />
        </>
      )}
      emptyDescription="Add your first branch. You need a brand, a tax profile and a price book first."
      prepare={(v, editing) => (editing ? { ...v, type: undefined } : v)}
    />
  );
}

