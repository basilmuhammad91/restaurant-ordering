import { inventoryItemInputSchema, inventoryItemUpdateSchema } from "@restoflux/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { ActiveBadge } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { fmtQty, KIND_LABEL, KIND_OPTIONS, UNIT_OPTIONS, useMoney } from "./shared";

interface Item { id: string; name: string; sku: string | null; kind: string; unit: string; category: string | null; referenceCost: number; reorderLevel: number | null; parLevel: number | null; isActive: boolean; deletedAt: string | null }

/** The things you buy, keep and cook with. Costs are typed in normal money ("400" for Rs. 400 per kg) and stored in minor units. */
export default function ItemsPage() {
  const { me } = useAuth();
  const { code, exp, money } = useMoney(me?.tenant.baseCurrency);
  const toMinor = (v: unknown) => Math.round(Number(v || 0) * 10 ** exp);

  const columns = useMemo<ColumnDef<Item, any>[]>(
    () => [
      { accessorKey: "name", header: "Item", meta: { sortKey: "name", label: "Item" }, cell: ({ row }) => <div><div className="font-medium">{row.original.name}</div>{row.original.sku && <div className="text-xs text-muted-foreground">{row.original.sku}</div>}</div> },
      { accessorKey: "kind", header: "Type", meta: { sortKey: "kind", label: "Type" }, cell: ({ getValue }) => <Badge variant="secondary">{KIND_LABEL[getValue() as string]}</Badge> },
      { accessorKey: "category", header: "Category", meta: { sortKey: "category", label: "Category" }, cell: ({ getValue }) => getValue() ?? "-" },
      { accessorKey: "unit", header: "Unit", meta: { sortKey: "unit", label: "Unit" } },
      { id: "cost", header: "Cost per unit", meta: { label: "Cost per unit" }, cell: ({ row }) => <span className="tabular-nums">{money(row.original.referenceCost)}</span> },
      { id: "reorder", header: "Reorder at", meta: { label: "Reorder at" }, cell: ({ row }) => (row.original.reorderLevel === null ? "-" : `${fmtQty(row.original.reorderLevel)} ${row.original.unit}`) },
      { accessorKey: "isActive", header: "Status", cell: ({ getValue }) => <ActiveBadge active={getValue()} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exp, code],
  );

  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "name", label: "Item name", type: "text", required: true, placeholder: "Chicken breast" },
      { name: "sku", label: "SKU / code", type: "text", nullable: true, span: 1, placeholder: "CHK-001" },
      { name: "category", label: "Category", type: "text", nullable: true, span: 1, placeholder: "Meat, Dairy, Dry goods…" },
      { name: "kind", label: "Type", type: "select", options: KIND_OPTIONS, span: 1, hint: "Prep items are made in your kitchen from a recipe." },
      { name: "unit", label: "Unit", type: "select", required: true, options: UNIT_OPTIONS, span: 1, hint: "Stock and recipes are counted in this unit." },
      { name: "referenceCost", label: `Cost per unit (${code})`, type: "number", min: 0, step: 0.01, span: 1, hint: "Used until a real purchase sets the average." },
      { name: "reorderLevel", label: "Reorder level", type: "number", nullable: true, min: 0, step: 0.001, span: 1, hint: "Shows as low at or below this." },
      { name: "parLevel", label: "Par level", type: "number", nullable: true, min: 0, step: 0.001, span: 1, hint: "What a suggested order tops up to." },
      { name: "isActive", label: "Active", type: "switch" },
    ],
    [code],
  );

  return (
    <CrudPage<Item>
      title="Inventory items" description="Ingredients, prep items and packaging. Set the unit once; stock, recipes and costs all use it."
      entity="item" path="/inventory-items" columns={columns} defaultSort="name" fields={fields}
      createSchema={inventoryItemInputSchema} updateSchema={inventoryItemUpdateSchema}
      defaults={{ name: "", sku: "", kind: "RAW", unit: "kg", category: "", referenceCost: 0, reorderLevel: "", parLevel: "", isActive: true }}
      toForm={(r) => ({ ...r, sku: r.sku ?? "", category: r.category ?? "", referenceCost: r.referenceCost / 10 ** exp, reorderLevel: r.reorderLevel ?? "", parLevel: r.parLevel ?? "" })}
      prepare={(v) => ({ ...v, referenceCost: toMinor(v.referenceCost) })}
      writePermission="items.manage"
      filters={[{ key: "kind", label: "Type", options: KIND_OPTIONS.map((k) => ({ value: k.value, label: k.label.split(" (")[0]! })) }]}
      searchPlaceholder="Name, SKU or category…" emptyDescription="Add your first ingredient, then give it an opening stock."
    />
  );
}
