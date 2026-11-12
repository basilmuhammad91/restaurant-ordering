import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { z } from "zod";
import { fmtDate, ActiveBadge } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { useMoney } from "@/features/inventory/shared";
import { useAuth } from "@/lib/auth";

interface Coupon { id: string; code: string; description: string | null; valueType: "PERCENT" | "AMOUNT"; value: number; minSubtotalMinor: number; maxUses: number | null; usedCount: number; validFrom: string | null; validTo: string | null; customerId: string | null; isActive: boolean; deletedAt: string | null }

// The form works in normal money and percent; these schemas check that. The API stores percent in basis points and money in minor units.
const base = z.object({
  code: z.string().trim().min(3, "At least 3 characters").max(40).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only"),
  description: z.string().max(200).nullable().optional(),
  valueType: z.enum(["PERCENT", "AMOUNT"]),
  value: z.number("Enter a value").positive("Must be more than zero"),
  minSubtotalMinor: z.number().min(0).optional(),
  maxUses: z.number().int().min(1).nullable().optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
const createSchema = base.refine((v) => v.valueType !== "PERCENT" || v.value <= 100, { path: ["value"], message: "A percentage cannot be more than 100" });

/** Codes customers type or show. The till sends only the code; the server decides what it is worth and whether it is valid. */
export default function CouponsPage() {
  const { me } = useAuth();
  const { code, exp, money } = useMoney(me?.tenant.baseCurrency);
  const toMinor = (v: unknown) => Math.round(Number(v || 0) * 10 ** exp);

  const columns = useMemo<ColumnDef<Coupon, any>[]>(
    () => [
      { accessorKey: "code", header: "Code", meta: { sortKey: "code", label: "Code" }, cell: ({ row }) => <div><div className="font-mono font-semibold">{row.original.code}</div>{row.original.description && <div className="text-xs text-muted-foreground">{row.original.description}</div>}</div> },
      { id: "value", header: "Gives", meta: { label: "Gives" }, cell: ({ row }) => (row.original.valueType === "PERCENT" ? `${row.original.value / 100}% off` : `${money(row.original.value)} off`) },
      { id: "min", header: "Minimum spend", meta: { label: "Minimum spend" }, cell: ({ row }) => (row.original.minSubtotalMinor ? money(row.original.minSubtotalMinor) : "-") },
      { id: "used", header: "Used", meta: { sortKey: "usedCount", label: "Used" }, cell: ({ row }) => <span className="tabular-nums">{row.original.usedCount}{row.original.maxUses ? ` / ${row.original.maxUses}` : ""}</span> },
      { id: "valid", header: "Valid", meta: { label: "Valid" }, cell: ({ row }) => (row.original.validFrom || row.original.validTo ? `${row.original.validFrom ? fmtDate(row.original.validFrom) : "any time"} to ${row.original.validTo ? fmtDate(row.original.validTo) : "no end"}` : "Always") },
      { id: "for", header: "For", meta: { label: "For" }, cell: ({ row }) => (row.original.customerId ? "One customer" : "Anyone") },
      { accessorKey: "isActive", header: "Status", cell: ({ getValue }) => <ActiveBadge active={getValue()} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exp, code],
  );
  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "code", label: "Code", type: "text", required: true, placeholder: "WELCOME10", hint: "Not case sensitive." },
      { name: "description", label: "Description", type: "text", nullable: true, placeholder: "10% off for new customers" },
      { name: "valueType", label: "Type", type: "select", span: 1, options: [{ value: "PERCENT", label: "Percent off" }, { value: "AMOUNT", label: `Fixed amount off (${code})` }] },
      { name: "value", label: `Value (% or ${code})`, type: "number", min: 0, step: 0.01, span: 1 },
      { name: "minSubtotalMinor", label: `Minimum spend (${code})`, type: "number", min: 0, step: 0.01, span: 1, hint: "Before discount and tax. 0 for none." },
      { name: "maxUses", label: "Total uses allowed", type: "number", nullable: true, min: 1, span: 1, hint: "Leave empty for unlimited." },
      { name: "validFrom", label: "Valid from", type: "date", nullable: true, span: 1 },
      { name: "validTo", label: "Valid until", type: "date", nullable: true, span: 1 },
      { name: "isActive", label: "Active", type: "switch" },
    ],
    [code],
  );

  return (
    <CrudPage<Coupon>
      title="Coupons" description="Discount codes. Each one can have a minimum spend, a use limit and dates. Loyalty redemptions create their own."
      entity="coupon" path="/coupons" columns={columns} defaultSort="-createdAt" fields={fields}
      createSchema={createSchema} updateSchema={base.partial()}
      defaults={{ code: "", description: "", valueType: "PERCENT", value: 10, minSubtotalMinor: 0, maxUses: "", validFrom: "", validTo: "", isActive: true }}
      toForm={(r) => ({ ...r, description: r.description ?? "", value: r.valueType === "PERCENT" ? r.value / 100 : r.value / 10 ** exp, minSubtotalMinor: r.minSubtotalMinor / 10 ** exp, maxUses: r.maxUses ?? "", validFrom: r.validFrom?.slice(0, 10) ?? "", validTo: r.validTo?.slice(0, 10) ?? "" })}
      prepare={(v) => ({ ...v, value: v.valueType === "AMOUNT" ? toMinor(v.value) : v.value, minSubtotalMinor: toMinor(v.minSubtotalMinor) })}
      writePermission="coupons.manage" searchPlaceholder="Code or description…" emptyDescription="Create a code such as WELCOME10 and tell your customers."
    />
  );
}
