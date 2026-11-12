import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { z } from "zod";
import { ActiveBadge, fmtDate } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { useMoney } from "@/features/inventory/shared";
import { useBranches } from "@/features/orders/common";
import { useAuth } from "@/lib/auth";

interface Promotion { id: string; name: string; description: string | null; valueType: "PERCENT" | "AMOUNT"; value: number; minSubtotalMinor: number; validFrom: string | null; validTo: string | null; daysOfWeek: number[]; startTime: string | null; endTime: string | null; locationIds: string[]; isActive: boolean; deletedAt: string | null }

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, such as 17:00").nullable().optional();
const base = z.object({
  name: z.string().trim().min(1, "Give it a name").max(100),
  description: z.string().max(300).nullable().optional(),
  valueType: z.enum(["PERCENT", "AMOUNT"]),
  value: z.number("Enter a value").positive("Must be more than zero"),
  minSubtotalMinor: z.number().min(0).optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  daysOfWeek: z.array(z.string()).optional(),
  startTime: time, endTime: time,
  locationIds: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});
const createSchema = base.refine((v) => v.valueType !== "PERCENT" || v.value <= 100, { path: ["value"], message: "A percentage cannot be more than 100" }).refine((v) => Boolean(v.startTime) === Boolean(v.endTime), { path: ["endTime"], message: "Set both times or neither" });

/** Offers a cashier can apply in one tap while they are running: happy hour, weekday lunch, a launch week. */
export default function PromotionsPage() {
  const { me } = useAuth();
  const branches = useBranches();
  const { code, exp, money } = useMoney(me?.tenant.baseCurrency);
  const toMinor = (v: unknown) => Math.round(Number(v || 0) * 10 ** exp);

  const columns = useMemo<ColumnDef<Promotion, any>[]>(
    () => [
      { accessorKey: "name", header: "Promotion", meta: { sortKey: "name", label: "Promotion" }, cell: ({ row }) => <div><div className="font-medium">{row.original.name}</div>{row.original.description && <div className="text-xs text-muted-foreground">{row.original.description}</div>}</div> },
      { id: "value", header: "Gives", meta: { label: "Gives" }, cell: ({ row }) => (row.original.valueType === "PERCENT" ? `${row.original.value / 100}% off` : `${money(row.original.value)} off`) },
      { id: "when", header: "When", meta: { label: "When" }, cell: ({ row }) => {
        const p = row.original;
        const days = p.daysOfWeek.length === 0 || p.daysOfWeek.length === 7 ? "Every day" : [...p.daysOfWeek].sort().map((d) => DAYS[d]).join(", ");
        return <div className="text-sm"><div>{days}{p.startTime && p.endTime ? `, ${p.startTime} to ${p.endTime}` : ""}</div><div className="text-xs text-muted-foreground">{p.validFrom || p.validTo ? `${p.validFrom ? fmtDate(p.validFrom) : "now"} to ${p.validTo ? fmtDate(p.validTo) : "no end"}` : "No end date"}</div></div>;
      } },
      { id: "where", header: "Where", meta: { label: "Where" }, cell: ({ row }) => (row.original.locationIds.length === 0 ? "All branches" : `${row.original.locationIds.length} branch${row.original.locationIds.length === 1 ? "" : "es"}`) },
      { accessorKey: "isActive", header: "Status", cell: ({ getValue }) => <ActiveBadge active={getValue()} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exp, code],
  );
  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "name", label: "Name", type: "text", required: true, placeholder: "Happy hour" },
      { name: "description", label: "Description", type: "text", nullable: true, placeholder: "Shown to the cashier" },
      { name: "valueType", label: "Type", type: "select", span: 1, options: [{ value: "PERCENT", label: "Percent off" }, { value: "AMOUNT", label: `Fixed amount off (${code})` }] },
      { name: "value", label: `Value (% or ${code})`, type: "number", min: 0, step: 0.01, span: 1 },
      { name: "minSubtotalMinor", label: `Minimum spend (${code})`, type: "number", min: 0, step: 0.01, span: 1 },
      { name: "daysOfWeek", label: "Days it runs", type: "multicheck", options: DAYS.map((d, i) => ({ value: String(i), label: d })), hint: "Tick none for every day." },
      { name: "startTime", label: "From (HH:MM)", type: "text", nullable: true, span: 1, placeholder: "17:00", hint: "Leave both times empty for all day." },
      { name: "endTime", label: "Until (HH:MM)", type: "text", nullable: true, span: 1, placeholder: "19:00" },
      { name: "validFrom", label: "Starts on", type: "date", nullable: true, span: 1 },
      { name: "validTo", label: "Ends on", type: "date", nullable: true, span: 1 },
      { name: "locationIds", label: "Branches", type: "multicheck", options: branches.map((b) => ({ value: b.id, label: b.name })), hint: "Tick none for every branch." },
      { name: "isActive", label: "Active", type: "switch" },
    ],
    [code, branches],
  );

  return (
    <CrudPage<Promotion>
      title="Promotions" description="Offers that run on certain days and times. While one is running, the POS shows it as a one-tap button."
      entity="promotion" path="/promotions" columns={columns} defaultSort="name" fields={fields}
      createSchema={createSchema} updateSchema={base.partial()}
      defaults={{ name: "", description: "", valueType: "PERCENT", value: 10, minSubtotalMinor: 0, daysOfWeek: [], startTime: "", endTime: "", validFrom: "", validTo: "", locationIds: [], isActive: true }}
      toForm={(r) => ({ ...r, description: r.description ?? "", value: r.valueType === "PERCENT" ? r.value / 100 : r.value / 10 ** exp, minSubtotalMinor: r.minSubtotalMinor / 10 ** exp, daysOfWeek: r.daysOfWeek.map(String), startTime: r.startTime ?? "", endTime: r.endTime ?? "", validFrom: r.validFrom?.slice(0, 10) ?? "", validTo: r.validTo?.slice(0, 10) ?? "" })}
      prepare={(v) => ({ ...v, value: v.valueType === "AMOUNT" ? toMinor(v.value) : v.value, minSubtotalMinor: toMinor(v.minSubtotalMinor), daysOfWeek: ((v.daysOfWeek as string[] | undefined) ?? []).map(Number) })}
      writePermission="promotions.manage" searchPlaceholder="Name…" emptyDescription="Create a happy hour or a weekday lunch offer."
    />
  );
}
