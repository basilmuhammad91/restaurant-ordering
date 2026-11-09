import { ORDER_TYPES, taxCategoryInputSchema, taxCategoryUpdateSchema, taxProfileInputSchema, taxProfileUpdateSchema } from "@restoflux/contracts";
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Mono, titleCase } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { PageHeader } from "@/components/page/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAll, useInvalidate } from "@/lib/queries";

interface Rule {
  id?: string;
  taxCategoryId: string | null;
  name: string;
  authorityCode: string;
  ratePercent: string | number;
  isCompound: boolean;
  orderTypes: string[];
  sortOrder: number;
}
interface Profile {
  id: string;
  name: string;
  countryCode: string;
  pricesIncludeTax: boolean;
  rules: Rule[];
  deletedAt: string | null;
}
interface Category {
  id: string;
  name: string;
  deletedAt: string | null;
}

const profileColumns: ColumnDef<Profile, any>[] = [
  { accessorKey: "name", header: "Name", meta: { sortKey: "name", label: "Name" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
  { accessorKey: "countryCode", header: "Country", meta: { sortKey: "countryCode", label: "Country" }, cell: ({ getValue }) => <Mono>{getValue()}</Mono> },
  { accessorKey: "pricesIncludeTax", header: "Prices", cell: ({ getValue }) => <Badge variant="outline">{getValue() ? "Include tax" : "Exclude tax"}</Badge> },
  {
    id: "rules", header: "Taxes", meta: { label: "Taxes" },
    cell: ({ row }) => (row.original.rules.length ? row.original.rules.map((r) => `${r.authorityCode} ${Number(r.ratePercent)}%`).join(" + ") : <span className="text-muted-foreground">No taxes</span>),
  },
];

const profileFields: FieldDef[] = [
  { name: "name", label: "Profile name", type: "text", required: true, placeholder: "Pakistan: Sindh" },
  { name: "countryCode", label: "Country (2 letters)", type: "text", required: true, span: 1, placeholder: "PK" },
  { name: "pricesIncludeTax", label: "Menu prices already include tax", type: "switch" },
];

function RulesEditor({ profile }: { profile: Profile }) {
  const categories = useAll<Category>("/tax-categories");
  const invalidate = useInvalidate();
  const [rules, setRules] = useState<Rule[]>(() => profile.rules.map((r) => ({ ...r, ratePercent: Number(r.ratePercent) })));
  const [error, setError] = useState<string | null>(null);

  const patch = (i: number, p: Partial<Rule>) => setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  const save = useMutation({
    mutationFn: () =>
      api.put(`/tax-profiles/${profile.id}/rules`, {
        rules: rules.map((r, i) => ({
          taxCategoryId: r.taxCategoryId || null, name: r.name, authorityCode: r.authorityCode, ratePercent: Number(r.ratePercent),
          isCompound: r.isCompound, orderTypes: r.orderTypes, sortOrder: i,
        })),
      }),
    onSuccess: async () => {
      toast.success("Tax rules saved");
      setError(null);
      await invalidate("/tax-profiles");
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 422 ? "Check each rule: name, authority code and a rate from 0 to 100." : errorMessage(e)),
  });

  return (
    <section className="space-y-3 border-t pt-4">
      <div>
        <h3 className="font-semibold">Taxes in this profile</h3>
        <p className="text-sm text-muted-foreground">
          {profile.pricesIncludeTax ? "Menu prices include these taxes (the tax is shown, not added)." : "These taxes are added on top of menu prices."} A rule can apply to all products or one tax category, and to specific order types.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {rules.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No taxes: orders in this profile are not taxed.</p>}
      {rules.map((r, i) => (
        <div key={r.id ?? i} className="space-y-3 rounded-lg border p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5"><Label>Name</Label><Input value={r.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="SRB sales tax" /></div>
            <div className="space-y-1.5"><Label>Authority code</Label><Input value={r.authorityCode} onChange={(e) => patch(i, { authorityCode: e.target.value.toUpperCase() })} placeholder="SRB" /></div>
            <div className="space-y-1.5"><Label>Rate %</Label><Input type="number" step="0.01" min={0} max={100} value={r.ratePercent} onChange={(e) => patch(i, { ratePercent: e.target.value })} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Applies to</Label>
              <Select value={r.taxCategoryId ?? "__all__"} onValueChange={(v) => patch(i, { taxCategoryId: v === "__all__" ? null : v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All tax categories</SelectItem>
                  {(categories.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end justify-between gap-3 rounded-lg border px-3 py-2">
              <Label htmlFor={`compound-${i}`} className="cursor-pointer">Compound (taxed on top of earlier taxes)</Label>
              <Switch id={`compound-${i}`} checked={r.isCompound} onCheckedChange={(c) => patch(i, { isCompound: c })} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sm text-muted-foreground">Order types (none ticked = all):</span>
            {ORDER_TYPES.map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <Checkbox checked={r.orderTypes.includes(t)} onCheckedChange={(c) => patch(i, { orderTypes: c ? [...r.orderTypes, t] : r.orderTypes.filter((x) => x !== t) })} />
                {titleCase(t)}
              </label>
            ))}
            <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={() => setRules((rs) => rs.filter((_, idx) => idx !== i))}><Trash2 /> Remove</Button>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setRules((rs) => [...rs, { taxCategoryId: null, name: "", authorityCode: "", ratePercent: 0, isCompound: false, orderTypes: [], sortOrder: rs.length }])}><Plus /> Add tax</Button>
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save taxes"}</Button>
      </div>
      <p className="text-xs text-muted-foreground">Example rates are for setup only. Check the current rate with your tax authority.</p>
    </section>
  );
}

export default function TaxesPage() {
  return (
    <>
      <PageHeader title="Taxes" description="Tax profiles define which taxes apply at a branch and whether menu prices include them." />
      <Tabs defaultValue="profiles">
        <TabsList>
          <TabsTrigger value="profiles">Tax profiles</TabsTrigger>
          <TabsTrigger value="categories">Tax categories</TabsTrigger>
        </TabsList>
        <TabsContent value="profiles" className="mt-4">
          <CrudPage<Profile>
            embedded title="Tax profiles" entity="tax profile" path="/tax-profiles" columns={profileColumns} defaultSort="name"
            fields={profileFields} createSchema={taxProfileInputSchema} updateSchema={taxProfileUpdateSchema}
            defaults={{ name: "", countryCode: "PK", pricesIncludeTax: false }} writePermission="taxes.manage" wide
            extraSections={(row) => <RulesEditor key={row.id} profile={row} />}
            emptyDescription="Create a profile (for example one per province or country), then add its taxes."
          />
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <CrudPage<Category>
            embedded title="Tax categories" entity="tax category" path="/tax-categories" defaultSort="name"
            columns={[{ accessorKey: "name", header: "Name", meta: { sortKey: "name", label: "Name" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> }]}
            fields={[{ name: "name", label: "Category name", type: "text", required: true, placeholder: "Standard, Zero-rated, Exempt" }]}
            createSchema={taxCategoryInputSchema} updateSchema={taxCategoryUpdateSchema} defaults={{ name: "" }} writePermission="taxes.manage"
            emptyDescription="Categories let one profile tax different products differently (for example food vs. packaged goods)."
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
