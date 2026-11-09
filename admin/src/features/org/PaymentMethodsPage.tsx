import { PAYMENT_METHOD_TYPES, paymentMethodInputSchema, paymentMethodUpdateSchema } from "@restoflux/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { ActiveBadge, titleCase } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { Badge } from "@/components/ui/badge";

interface PaymentMethod {
  id: string;
  name: string;
  type: string;
  providerCode: string | null;
  requiresReference: boolean;
  opensDrawer: boolean;
  isActive: boolean;
  deletedAt: string | null;
}

const typeOptions = PAYMENT_METHOD_TYPES.map((t) => ({ value: t, label: t === "QR" ? "QR payment" : titleCase(t) }));

const columns: ColumnDef<PaymentMethod, any>[] = [
  { accessorKey: "name", header: "Name", meta: { sortKey: "name", label: "Name" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
  { accessorKey: "type", header: "Type", meta: { sortKey: "type", label: "Type" }, cell: ({ getValue }) => <Badge variant="outline">{titleCase(getValue())}</Badge> },
  { accessorKey: "providerCode", header: "Provider", cell: ({ getValue }) => getValue() ?? "-" },
  { accessorKey: "opensDrawer", header: "Opens drawer", cell: ({ getValue }) => (getValue() ? "Yes" : "No") },
  { accessorKey: "requiresReference", header: "Needs reference", cell: ({ getValue }) => (getValue() ? "Yes" : "No") },
  { accessorKey: "isActive", header: "Status", cell: ({ getValue }) => <ActiveBadge active={getValue()} /> },
];

const fields: FieldDef[] = [
  { name: "name", label: "Name", type: "text", required: true, placeholder: "JazzCash, Visa terminal ..." },
  { name: "type", label: "Type", type: "select", options: typeOptions, required: true, span: 1 },
  { name: "providerCode", label: "Provider code", type: "text", nullable: true, span: 1, placeholder: "JAZZCASH", hint: "Optional, for integrations later." },
  { name: "requiresReference", label: "Ask for a reference number (card slip, transaction id)", type: "switch" },
  { name: "opensDrawer", label: "Opens the cash drawer", type: "switch" },
  { name: "isActive", label: "Active", type: "switch" },
];

export default function PaymentMethodsPage() {
  return (
    <CrudPage<PaymentMethod>
      title="Payment methods" description="Cash, cards, mobile wallets and more. Enable the ones each branch accepts in the branch settings." entity="payment method" path="/payment-methods"
      columns={columns} defaultSort="name" fields={fields} createSchema={paymentMethodInputSchema} updateSchema={paymentMethodUpdateSchema}
      defaults={{ name: "", type: "CASH", providerCode: "", requiresReference: false, opensDrawer: false, isActive: true }}
      writePermission="payment-methods.manage" filters={[{ key: "type", label: "Type", options: typeOptions }]}
    />
  );
}
