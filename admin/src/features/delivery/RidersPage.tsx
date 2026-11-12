import { riderInputSchema, riderUpdateSchema } from "@restoflux/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { ActiveBadge } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";

interface Rider { id: string; name: string; phone: string | null; vehicle: string | null; isActive: boolean; deletedAt: string | null }

/** The people who bring orders to customers. */
export default function RidersPage() {
  const columns = useMemo<ColumnDef<Rider, any>[]>(
    () => [
      { accessorKey: "name", header: "Rider", meta: { sortKey: "name", label: "Rider" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
      { accessorKey: "phone", header: "Phone", meta: { label: "Phone" }, cell: ({ getValue }) => getValue() ?? "-" },
      { accessorKey: "vehicle", header: "Vehicle", meta: { label: "Vehicle" }, cell: ({ getValue }) => getValue() ?? "-" },
      { accessorKey: "isActive", header: "Status", cell: ({ getValue }) => <ActiveBadge active={getValue()} /> },
    ],
    [],
  );
  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "phone", label: "Phone", type: "text", nullable: true, span: 1 },
      { name: "vehicle", label: "Vehicle", type: "text", nullable: true, span: 1, placeholder: "Bike, van…" },
      { name: "isActive", label: "Active", type: "switch" },
    ],
    [],
  );
  return (
    <CrudPage<Rider>
      title="Riders" description="Your delivery team. Only active riders can be given an order."
      entity="rider" path="/riders" columns={columns} defaultSort="name" fields={fields}
      createSchema={riderInputSchema} updateSchema={riderUpdateSchema}
      defaults={{ name: "", phone: "", vehicle: "", isActive: true }}
      toForm={(r) => ({ ...r, phone: r.phone ?? "", vehicle: r.vehicle ?? "" })}
      writePermission="riders.manage" searchPlaceholder="Name, phone…" emptyDescription="Add your first rider, then assign orders from the Deliveries board."
    />
  );
}
