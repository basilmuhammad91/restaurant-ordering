import { supplierInputSchema, supplierUpdateSchema } from "@restoflux/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ActiveBadge } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/features/menu/shared";
import { useInvOptions, useMoney } from "@/features/inventory/shared";
import { api, errorMessage, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useInvalidate } from "@/lib/queries";
import type { Supplier } from "./shared";

interface CatalogueRow { id: string; itemId: string; packName: string; packQty: number; priceMinor: number; isPreferred: boolean; item: { name: string; unit: string } }

/** The people you buy from, with payment terms and, under each one, the packs and prices they sell. */
export default function SuppliersPage() {
  const columns = useMemo<ColumnDef<Supplier, any>[]>(
    () => [
      { accessorKey: "name", header: "Supplier", meta: { sortKey: "name", label: "Supplier" }, cell: ({ row }) => <div><div className="font-medium">{row.original.name}</div>{row.original.code && <div className="text-xs text-muted-foreground">{row.original.code}</div>}</div> },
      { id: "contact", header: "Contact", meta: { label: "Contact" }, cell: ({ row }) => <div className="text-sm"><div>{row.original.contactName ?? "-"}</div><div className="text-xs text-muted-foreground">{[row.original.phone, row.original.email].filter(Boolean).join(" · ")}</div></div> },
      { accessorKey: "paymentTermsDays", header: "Terms", meta: { sortKey: "paymentTermsDays", label: "Terms" }, cell: ({ getValue }) => (getValue() === 0 ? "On delivery" : `${getValue()} days`) },
      { accessorKey: "isActive", header: "Status", cell: ({ getValue }) => <ActiveBadge active={getValue()} /> },
    ],
    [],
  );
  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "name", label: "Supplier name", type: "text", required: true, placeholder: "Karachi Fresh Produce" },
      { name: "code", label: "Code", type: "text", nullable: true, span: 1, placeholder: "KFP" },
      { name: "contactName", label: "Contact person", type: "text", nullable: true, span: 1 },
      { name: "phone", label: "Phone", type: "text", nullable: true, span: 1 },
      { name: "email", label: "Email", type: "email", nullable: true, span: 1 },
      { name: "address", label: "Address", type: "text", nullable: true },
      { name: "taxId", label: "Tax number", type: "text", nullable: true, span: 1 },
      { name: "paymentTermsDays", label: "Payment terms (days)", type: "number", min: 0, max: 365, span: 1, hint: "0 means pay on delivery." },
      { name: "notes", label: "Notes", type: "textarea", nullable: true },
      { name: "isActive", label: "Active", type: "switch" },
    ],
    [],
  );
  return (
    <CrudPage<Supplier>
      title="Suppliers" description="Who you buy from. Open a supplier to set the packs and prices they sell."
      entity="supplier" path="/suppliers" columns={columns} defaultSort="name" fields={fields}
      createSchema={supplierInputSchema} updateSchema={supplierUpdateSchema}
      defaults={{ name: "", code: "", contactName: "", phone: "", email: "", address: "", taxId: "", paymentTermsDays: 0, notes: "", isActive: true }}
      toForm={(r) => ({ ...r, code: r.code ?? "", contactName: r.contactName ?? "", phone: r.phone ?? "", email: r.email ?? "", address: r.address ?? "", taxId: r.taxId ?? "", notes: r.notes ?? "" })}
      writePermission="suppliers.manage" searchPlaceholder="Name, code, contact…" wide
      extraSections={(row) => <Catalogue supplierId={row.id} />}
      emptyDescription="Add your first supplier, then list what they sell."
    />
  );
}

function Catalogue({ supplierId }: { supplierId: string }) {
  const { me, can } = useAuth();
  const { items } = useInvOptions();
  const { money, toMinor, code } = useMoney(me?.tenant.baseCurrency);
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: ["/supplier-items", "for", supplierId], queryFn: async () => (await api.get<Paged<CatalogueRow>>("/supplier-items", { supplierId, pageSize: 100 })).data });
  const [itemId, setItemId] = useState("");
  const [packName, setPackName] = useState("");
  const [packQty, setPackQty] = useState("1");
  const [price, setPrice] = useState("");
  const unit = items.find((i) => i.id === itemId)?.unit ?? "";
  const refresh = () => invalidate("/supplier-items");
  const add = useMutation({
    mutationFn: () => api.post("/supplier-items", { supplierId, itemId, packName: packName.trim() || "Each", packQty: Number(packQty), priceMinor: toMinor(Number(price)), isPreferred: (q.data ?? []).every((r) => r.itemId !== itemId) }),
    onSuccess: async () => { setItemId(""); setPackName(""); setPackQty("1"); setPrice(""); await refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const prefer = useMutation({ mutationFn: (id: string) => api.patch(`/supplier-items/${id}`, { isPreferred: true }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/supplier-items/${id}`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const canEdit = can("suppliers.manage");

  return (
    <div className="mt-6 space-y-3 border-t pt-4">
      <div><h3 className="font-semibold">What they sell</h3><p className="text-sm text-muted-foreground">A pack is how the supplier sells it, such as "Sack 25 kg". The star marks who you normally buy each item from.</p></div>
      <div className="divide-y rounded-lg border">
        {(q.data ?? []).length === 0 && <p className="p-3 text-sm text-muted-foreground">Nothing listed yet.</p>}
        {(q.data ?? []).map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <div><span className="font-medium">{r.item.name}</span> <span className="text-muted-foreground">· {r.packName} ({r.packQty} {r.item.unit})</span></div>
            <div className="flex items-center gap-1"><span className="tabular-nums">{money(r.priceMinor)}</span>
              {canEdit && <><Button type="button" size="icon" variant="ghost" aria-label={r.isPreferred ? "Preferred supplier" : "Make preferred"} onClick={() => !r.isPreferred && prefer.mutate(r.id)}><Star className={`size-4 ${r.isPreferred ? "fill-amber-400 text-amber-500" : ""}`} /></Button><Button type="button" size="icon" variant="ghost" aria-label="Remove" onClick={() => remove.mutate(r.id)}><Trash2 className="size-4" /></Button></>}
            </div>
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="grid items-end gap-2 sm:grid-cols-[1.4fr_1fr_0.7fr_0.9fr_auto]">
          <div className="space-y-1"><Label>Item</Label><SimpleSelect value={itemId} onChange={setItemId} label="Item" options={items.map((i) => ({ value: i.id, label: i.name }))} placeholder="Choose" /></div>
          <div className="space-y-1"><Label htmlFor="cat-pack">Pack name</Label><Input id="cat-pack" placeholder="Sack 25 kg" value={packName} onChange={(e) => setPackName(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="cat-qty">Holds{unit ? ` (${unit})` : ""}</Label><Input id="cat-qty" inputMode="decimal" value={packQty} onChange={(e) => setPackQty(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="cat-price">Price ({code})</Label><Input id="cat-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <Button type="button" disabled={!itemId || !(Number(packQty) > 0) || price === "" || add.isPending} onClick={() => add.mutate()}>Add</Button>
        </div>
      )}
    </div>
  );
}
