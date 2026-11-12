import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { z } from "zod";
import { ActiveBadge } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { useBranches } from "@/features/orders/common";
import { useAuth } from "@/lib/auth";
import { formatMinor, useCurrencies } from "@/lib/money";

interface Zone { id: string; locationId: string; name: string; feeMinor: number; minOrderMinor: number; estimatedMinutes: number; isActive: boolean; deletedAt: string | null }

const base = z.object({
  locationId: z.string().min(1, "Choose a branch"),
  name: z.string().trim().min(1, "Give it a name").max(100),
  feeMinor: z.number().min(0).optional(),
  minOrderMinor: z.number().min(0).optional(),
  estimatedMinutes: z.number().int().min(1).max(600).optional(),
  isActive: z.boolean().optional(),
});

/** Areas a branch delivers to, with the fee and the minimum order. At the till, picking a zone fills in the delivery fee. */
export default function ZonesPage() {
  const { me } = useAuth();
  const branches = useBranches();
  const { exponent } = useCurrencies();
  const currencyOf = (locationId: string) => branches.find((b) => b.id === locationId)?.currencyCode ?? me?.tenant.baseCurrency ?? "USD";
  const money = (minor: number, locationId: string) => formatMinor(minor, currencyOf(locationId), exponent(currencyOf(locationId)));
  const toMinor = (v: unknown, locationId: string) => Math.round(Number(v || 0) * 10 ** exponent(currencyOf(locationId)));

  const columns = useMemo<ColumnDef<Zone, any>[]>(
    () => [
      { accessorKey: "name", header: "Zone", meta: { sortKey: "name", label: "Zone" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
      { id: "branch", header: "Branch", meta: { label: "Branch" }, accessorFn: (r) => branches.find((b) => b.id === r.locationId)?.name ?? "" },
      { id: "fee", header: "Delivery fee", meta: { sortKey: "feeMinor", label: "Delivery fee" }, cell: ({ row }) => <span className="tabular-nums">{money(row.original.feeMinor, row.original.locationId)}</span> },
      { id: "min", header: "Minimum order", meta: { label: "Minimum order" }, cell: ({ row }) => (row.original.minOrderMinor ? money(row.original.minOrderMinor, row.original.locationId) : "-") },
      { accessorKey: "estimatedMinutes", header: "Usual time", meta: { label: "Usual time" }, cell: ({ getValue }) => `${getValue()} min` },
      { accessorKey: "isActive", header: "Status", cell: ({ getValue }) => <ActiveBadge active={getValue()} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branches, exponent],
  );
  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "locationId", label: "Branch", type: "select", required: true, options: branches.map((b) => ({ value: b.id, label: b.name })), disabledWhen: (editing) => editing },
      { name: "name", label: "Zone name", type: "text", required: true, placeholder: "Clifton, DHA Phase 5…" },
      { name: "feeMinor", label: "Delivery fee", type: "number", min: 0, step: 0.01, span: 1, hint: "In the branch's currency." },
      { name: "minOrderMinor", label: "Minimum order", type: "number", min: 0, step: 0.01, span: 1 },
      { name: "estimatedMinutes", label: "Usual time (minutes)", type: "number", min: 1, max: 600, span: 1 },
      { name: "isActive", label: "Active", type: "switch" },
    ],
    [branches],
  );

  return (
    <CrudPage<Zone>
      title="Zones & fees" description="Where each branch delivers and what it charges."
      entity="zone" path="/delivery-zones" columns={columns} defaultSort="name" fields={fields}
      createSchema={base} updateSchema={base.partial()}
      defaults={{ locationId: branches[0]?.id ?? "", name: "", feeMinor: 0, minOrderMinor: 0, estimatedMinutes: 45, isActive: true }}
      toForm={(r) => ({ ...r, feeMinor: r.feeMinor / 10 ** exponent(currencyOf(r.locationId)), minOrderMinor: r.minOrderMinor / 10 ** exponent(currencyOf(r.locationId)) })}
      prepare={(v) => ({ ...v, feeMinor: toMinor(v.feeMinor, String(v.locationId)), minOrderMinor: toMinor(v.minOrderMinor, String(v.locationId)) })}
      writePermission="delivery.manage" searchPlaceholder="Zone name…" emptyDescription="Add the areas you deliver to. The POS uses the fee when you take a delivery order."
    />
  );
}
