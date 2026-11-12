import { employeeInputSchema, employeeUpdateSchema } from "@restoflux/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { z } from "zod";
import { ActiveBadge, fmtDate } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { useMoney } from "@/features/inventory/shared";
import { useBranches } from "@/features/orders/common";
import { useAuth } from "@/lib/auth";

interface Employee { id: string; name: string; locationId: string | null; phone: string | null; email: string | null; position: string | null; hourlyRateMinor: number | null; startDate: string | null; notes: string | null; isActive: boolean; deletedAt: string | null }
void employeeInputSchema;
void employeeUpdateSchema;

// The form works in normal money (an hourly rate such as 450); the API takes minor units.
const base = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100),
  locationId: z.string().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.union([z.literal(""), z.string().email("Not a valid email")]).nullable().optional(),
  position: z.string().max(60).nullable().optional(),
  hourlyRateMinor: z.number().min(0).nullable().optional(),
  startDate: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

/** The people who work for you. A login is separate: an employee does not need one. */
export default function EmployeesPage() {
  const { me } = useAuth();
  const branches = useBranches();
  const { code, exp, money } = useMoney(me?.tenant.baseCurrency);

  const columns = useMemo<ColumnDef<Employee, any>[]>(
    () => [
      { accessorKey: "name", header: "Employee", meta: { sortKey: "name", label: "Employee" }, cell: ({ row }) => <div><div className="font-medium">{row.original.name}</div><div className="text-xs text-muted-foreground">{[row.original.phone, row.original.email].filter(Boolean).join(" · ")}</div></div> },
      { accessorKey: "position", header: "Position", meta: { sortKey: "position", label: "Position" }, cell: ({ getValue }) => getValue() ?? "-" },
      { id: "branch", header: "Works at", meta: { label: "Works at" }, accessorFn: (r) => (r.locationId ? branches.find((b) => b.id === r.locationId)?.name ?? "" : "Any branch") },
      { id: "rate", header: "Hourly rate", meta: { label: "Hourly rate" }, cell: ({ row }) => (row.original.hourlyRateMinor === null ? "-" : <span className="tabular-nums">{money(row.original.hourlyRateMinor)}</span>) },
      { accessorKey: "startDate", header: "Started", meta: { sortKey: "startDate", label: "Started" }, cell: ({ getValue }) => (getValue() ? fmtDate(getValue()) : "-") },
      { accessorKey: "isActive", header: "Status", cell: ({ getValue }) => <ActiveBadge active={getValue()} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branches, exp, code],
  );
  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "position", label: "Position", type: "text", nullable: true, span: 1, placeholder: "Waiter, Cook, Cashier…" },
      { name: "locationId", label: "Usual branch", type: "select", allowEmpty: true, span: 1, options: branches.map((b) => ({ value: b.id, label: b.name })) },
      { name: "phone", label: "Phone", type: "text", nullable: true, span: 1 },
      { name: "email", label: "Email", type: "email", nullable: true, span: 1 },
      { name: "hourlyRateMinor", label: `Hourly rate (${code})`, type: "number", nullable: true, min: 0, step: 0.01, span: 1, hint: "Used for the labour-cost estimate on the time clock." },
      { name: "startDate", label: "Start date", type: "date", nullable: true, span: 1 },
      { name: "notes", label: "Notes", type: "textarea", nullable: true },
      { name: "isActive", label: "Currently employed", type: "switch" },
    ],
    [branches, code],
  );

  return (
    <CrudPage<Employee>
      title="Employees" description="Staff records for the roster and time clock."
      entity="employee" path="/employees" columns={columns} defaultSort="name" fields={fields}
      createSchema={base} updateSchema={base.partial()}
      defaults={{ name: "", position: "", locationId: null, phone: "", email: "", hourlyRateMinor: "", startDate: "", notes: "", isActive: true }}
      toForm={(r) => ({ ...r, position: r.position ?? "", phone: r.phone ?? "", email: r.email ?? "", hourlyRateMinor: r.hourlyRateMinor === null ? "" : r.hourlyRateMinor / 10 ** exp, startDate: r.startDate?.slice(0, 10) ?? "", notes: r.notes ?? "" })}
      prepare={(v) => ({ ...v, hourlyRateMinor: v.hourlyRateMinor === null || v.hourlyRateMinor === undefined || v.hourlyRateMinor === "" ? null : Math.round(Number(v.hourlyRateMinor) * 10 ** exp) })}
      writePermission="staff.manage" searchPlaceholder="Name, phone, position…" wide emptyDescription="Add the people who work for you."
    />
  );
}
