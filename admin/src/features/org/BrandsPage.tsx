import { brandInputSchema, brandUpdateSchema } from "@restoflux/contracts";
import { ActiveBadge, DateCell, Mono } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import type { ColumnDef } from "@tanstack/react-table";

interface Brand {
  id: string;
  name: string;
  slug: string;
  cuisine: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
  isActive: boolean;
  createdAt: string;
  deletedAt: string | null;
}

const columns: ColumnDef<Brand, any>[] = [
  {
    accessorKey: "name", header: "Name", meta: { sortKey: "name", label: "Name" },
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        {row.original.primaryColor && <span className="size-3 rounded-full border" style={{ background: row.original.primaryColor }} />}
        <span className="font-medium">{row.original.name}</span>
      </div>
    ),
  },
  { accessorKey: "slug", header: "Web address", meta: { label: "Slug" }, cell: ({ getValue }) => <Mono>{getValue()}</Mono> },
  { accessorKey: "cuisine", header: "Cuisine", cell: ({ getValue }) => getValue() ?? "-" },
  { accessorKey: "isActive", header: "Status", cell: ({ getValue }) => <ActiveBadge active={getValue()} /> },
  { accessorKey: "createdAt", header: "Created", meta: { sortKey: "createdAt", label: "Created" }, cell: ({ getValue }) => <DateCell value={getValue()} /> },
];

const fields: FieldDef[] = [
  { name: "name", label: "Brand name", type: "text", required: true },
  { name: "slug", label: "Slug", type: "text", required: true, hint: "Used in the customer ordering site address. Lowercase letters, numbers and dashes." },
  { name: "cuisine", label: "Cuisine", type: "text", nullable: true, span: 1, placeholder: "Burgers, Pakistani grill ..." },
  { name: "primaryColor", label: "Brand colour", type: "text", nullable: true, span: 1, placeholder: "#a3141c" },
  { name: "logoUrl", label: "Logo URL", type: "text", nullable: true, placeholder: "https://..." },
  { name: "isActive", label: "Active", type: "switch" },
];

export default function BrandsPage() {
  return (
    <CrudPage<Brand>
      title="Brands" description="Your restaurant concepts. Each brand has its own menu and ordering website." entity="brand" path="/brands"
      columns={columns} defaultSort="name" fields={fields} createSchema={brandInputSchema} updateSchema={brandUpdateSchema}
      defaults={{ name: "", slug: "", cuisine: "", primaryColor: "", logoUrl: "", isActive: true }}
      writePermission="org.manage" filters={[{ key: "isActive", label: "Status", options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }] }]}
      emptyDescription="Create your first brand, then add branches under it."
    />
  );
}
