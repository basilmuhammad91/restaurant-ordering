import { roleInputSchema, roleUpdateSchema } from "@restoflux/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound } from "lucide-react";
import { useNavigate } from "react-router";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isOwner: boolean;
  unlimitedLimits: boolean;
  maxDiscountPercent: number;
  permissions: string[];
  userCount: number;
  deletedAt: string | null;
}

const columns: ColumnDef<Role, any>[] = [
  {
    accessorKey: "name", header: "Role", meta: { sortKey: "name", label: "Name" },
    cell: ({ row }) => (
      <div>
        <div className="flex items-center gap-2 font-medium">
          {row.original.name}
          {row.original.isOwner && <Badge>Owner</Badge>}
          {row.original.isSystem && !row.original.isOwner && <Badge variant="outline">Default</Badge>}
        </div>
        {row.original.description && <div className="max-w-md truncate text-xs text-muted-foreground">{row.original.description}</div>}
      </div>
    ),
  },
  { accessorKey: "userCount", header: "Users", meta: { label: "Users" } },
  { id: "perms", header: "Permissions", meta: { label: "Permissions" }, accessorFn: (r) => r.permissions.length },
  { id: "discount", header: "Max discount", meta: { label: "Max discount" }, accessorFn: (r) => `${r.maxDiscountPercent}%` },
  { id: "limits", header: "Approval limits", meta: { label: "Limits" }, accessorFn: (r) => (r.unlimitedLimits ? "Unlimited" : "Per currency") },
];

const fields: FieldDef[] = [
  { name: "name", label: "Role name", type: "text", required: true },
  { name: "description", label: "Description", type: "textarea", nullable: true },
  { name: "maxDiscountPercent", label: "Maximum discount (%)", type: "number", min: 0, max: 100, step: 0.5, hint: "Above this, a manager's approval is needed." },
];

export default function RolesPage() {
  const navigate = useNavigate();
  return (
    <CrudPage<Role>
      title="Roles & permissions" description="A role is a set of permissions plus approval limits. Edit what each role can do in the permission matrix." entity="role" path="/roles"
      columns={columns} defaultSort="name" fields={fields} createSchema={roleInputSchema} updateSchema={roleUpdateSchema}
      defaults={{ name: "", description: "", maxDiscountPercent: 0 }} writePermission="roles.manage" archivable={false}
      rowActions={(row) => (
        <DropdownMenuItem onClick={() => navigate(`/settings/roles/${row.id}`)}>
          <KeyRound /> Permissions & limits
        </DropdownMenuItem>
      )}
      emptyDescription="Roles are created for every company by default."
    />
  );
}
