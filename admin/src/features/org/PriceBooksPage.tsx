import { priceBookInputSchema, priceBookUpdateSchema } from "@restoflux/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { Mono } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { Badge } from "@/components/ui/badge";
import { useAll } from "@/lib/queries";
import { useCurrencies } from "@/lib/money";

interface PriceBook {
  id: string;
  name: string;
  currencyCode: string;
  brandId: string | null;
  isDefault: boolean;
  deletedAt: string | null;
}

const columns: ColumnDef<PriceBook, any>[] = [
  { accessorKey: "name", header: "Name", meta: { sortKey: "name", label: "Name" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
  { accessorKey: "currencyCode", header: "Currency", meta: { sortKey: "currencyCode", label: "Currency" }, cell: ({ getValue }) => <Mono>{getValue()}</Mono> },
  { accessorKey: "isDefault", header: "Default", cell: ({ getValue }) => (getValue() ? <Badge>Default</Badge> : null) },
];

export default function PriceBooksPage() {
  const { currencies } = useCurrencies();
  const brands = useAll<{ id: string; name: string }>("/brands");
  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "name", label: "Name", type: "text", required: true, placeholder: "Pakistan PKR" },
      { name: "currencyCode", label: "Currency", type: "select", required: true, span: 1, options: currencies.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` })) },
      { name: "brandId", label: "Brand (optional)", type: "select", allowEmpty: true, span: 1, options: (brands.data ?? []).map((b) => ({ value: b.id, label: b.name })) },
      { name: "isDefault", label: "Default price book", type: "switch" },
    ],
    [currencies, brands.data],
  );

  return (
    <CrudPage<PriceBook>
      title="Price books" description="A price book is a set of prices in one currency. Each branch uses one. Prices themselves are added with the menu." entity="price book" path="/price-books"
      columns={columns} defaultSort="name" fields={fields} createSchema={priceBookInputSchema} updateSchema={priceBookUpdateSchema}
      defaults={{ name: "", currencyCode: "PKR", brandId: null, isDefault: false }} writePermission="org.manage"
    />
  );
}
