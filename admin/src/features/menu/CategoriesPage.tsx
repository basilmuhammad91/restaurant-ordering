import { categoryInputSchema, categoryUpdateSchema } from "@restoflux/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { ActiveBadge } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { useScope } from "@/lib/scope";
import { useBrands, useDefaultBrandId } from "./shared";

interface Category { id: string; brandId: string; name: string; imageUrl: string | null; sortOrder: number; isActive: boolean; deletedAt: string | null }

export default function CategoriesPage() {
  const brands = useBrands();
  const { brandId } = useScope();
  const defaultBrand = useDefaultBrandId();
  const brandName = (id: string) => brands.data?.find((b) => b.id === id)?.name ?? "";

  const columns = useMemo<ColumnDef<Category, any>[]>(
    () => [
      { accessorKey: "name", header: "Category", meta: { sortKey: "name", label: "Category" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
      { id: "brand", header: "Brand", meta: { label: "Brand" }, accessorFn: (r) => brandName(r.brandId) },
      { accessorKey: "sortOrder", header: "Order", meta: { sortKey: "sortOrder", label: "Order" } },
      { accessorKey: "isActive", header: "Status", cell: ({ getValue }) => <ActiveBadge active={getValue()} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brands.data],
  );

  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "brandId", label: "Brand", type: "select", required: true, options: (brands.data ?? []).map((b) => ({ value: b.id, label: b.name })), disabledWhen: (editing) => editing, hint: "A category belongs to one brand." },
      { name: "name", label: "Category name", type: "text", required: true, placeholder: "Burgers" },
      { name: "sortOrder", label: "Display order", type: "number", span: 1, min: 0, hint: "Lower numbers show first on the POS and website." },
      { name: "imageUrl", label: "Image URL", type: "text", nullable: true, span: 1, placeholder: "https://…" },
      { name: "isActive", label: "Active", type: "switch" },
    ],
    [brands.data],
  );

  return (
    <CrudPage<Category>
      title="Categories" description="Group products the way customers look for them: Burgers, Drinks, Desserts."
      entity="category" path="/categories" columns={columns} defaultSort="sortOrder,name" fields={fields}
      createSchema={categoryInputSchema} updateSchema={categoryUpdateSchema}
      defaults={{ brandId: defaultBrand, name: "", sortOrder: 0, imageUrl: "", isActive: true }}
      listParams={brandId ? { brandId } : {}} writePermission="menu.manage"
      emptyDescription="Create your first category, then add products to it."
    />
  );
}
