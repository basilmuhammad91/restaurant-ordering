import { diningTableInputSchema, diningTableUpdateSchema, kitchenStationInputSchema, kitchenStationUpdateSchema } from "@restoflux/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { ActiveBadge, Mono } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { PageHeader } from "@/components/page/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAll } from "@/lib/queries";

interface Location { id: string; name: string; type: string }
interface Table { id: string; locationId: string; name: string; seats: number; section: string | null; isActive: boolean; deletedAt: string | null }
interface Station { id: string; locationId: string; key: string; name: string; sortOrder: number; isActive: boolean; deletedAt: string | null }

export default function TablesPage() {
  const locations = useAll<Location>("/locations", { type: "BRANCH" });
  const branchOptions = useMemo(() => (locations.data ?? []).map((l) => ({ value: l.id, label: l.name })), [locations.data]);
  const nameOf = (id: string) => locations.data?.find((l) => l.id === id)?.name ?? "-";

  const tableColumns: ColumnDef<Table, any>[] = [
    { accessorKey: "name", header: "Table", meta: { sortKey: "name", label: "Table" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { id: "branch", header: "Branch", meta: { label: "Branch" }, accessorFn: (r) => nameOf(r.locationId) },
    { accessorKey: "section", header: "Section", meta: { sortKey: "section", label: "Section" }, cell: ({ getValue }) => getValue() ?? "-" },
    { accessorKey: "seats", header: "Seats", meta: { sortKey: "seats", label: "Seats" } },
    { accessorKey: "isActive", header: "Status", cell: ({ getValue }) => <ActiveBadge active={getValue()} /> },
  ];
  const tableFields: FieldDef[] = [
    { name: "locationId", label: "Branch", type: "select", required: true, options: branchOptions, mode: "create" },
    { name: "name", label: "Table name", type: "text", required: true, span: 1, placeholder: "T1" },
    { name: "seats", label: "Seats", type: "number", min: 1, max: 100, span: 1 },
    { name: "section", label: "Section", type: "text", nullable: true, placeholder: "Window, Main hall, Terrace" },
    { name: "isActive", label: "Active", type: "switch" },
  ];

  const stationColumns: ColumnDef<Station, any>[] = [
    { accessorKey: "name", header: "Station", meta: { sortKey: "name", label: "Station" }, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { accessorKey: "key", header: "Key", meta: { sortKey: "key", label: "Key" }, cell: ({ getValue }) => <Mono>{getValue()}</Mono> },
    { id: "branch", header: "Branch", meta: { label: "Branch" }, accessorFn: (r) => nameOf(r.locationId) },
    { accessorKey: "sortOrder", header: "Order", meta: { sortKey: "sortOrder", label: "Order" } },
    { accessorKey: "isActive", header: "Status", cell: ({ getValue }) => <ActiveBadge active={getValue()} /> },
  ];
  const stationFields: FieldDef[] = [
    { name: "locationId", label: "Branch", type: "select", required: true, options: branchOptions, mode: "create" },
    { name: "name", label: "Station name", type: "text", required: true, span: 1, placeholder: "Grill" },
    { name: "key", label: "Key", type: "text", required: true, span: 1, placeholder: "GRILL", hint: "Products are routed to a station by this key." },
    { name: "sortOrder", label: "Display order", type: "number", min: 0, max: 999, span: 1 },
    { name: "isActive", label: "Active", type: "switch" },
  ];
  const branchFilter = [{ key: "locationId", label: "Branch", options: branchOptions }];

  return (
    <>
      <PageHeader title="Tables & stations" description="Dining tables for dine-in orders, and the kitchen stations that tickets are routed to." />
      <Tabs defaultValue="tables">
        <TabsList>
          <TabsTrigger value="tables">Dining tables</TabsTrigger>
          <TabsTrigger value="stations">Kitchen stations</TabsTrigger>
        </TabsList>
        <TabsContent value="tables" className="mt-4">
          <CrudPage<Table>
            embedded title="Tables" entity="table" path="/dining-tables" columns={tableColumns} defaultSort="name" fields={tableFields}
            createSchema={diningTableInputSchema} updateSchema={diningTableUpdateSchema} defaults={{ locationId: "", name: "", seats: 4, section: "", isActive: true }}
            writePermission="locations.manage" filters={branchFilter} emptyDescription="Add tables to a branch to take dine-in orders."
          />
        </TabsContent>
        <TabsContent value="stations" className="mt-4">
          <CrudPage<Station>
            embedded title="Stations" entity="station" path="/kitchen-stations" columns={stationColumns} defaultSort="sortOrder" fields={stationFields}
            createSchema={kitchenStationInputSchema} updateSchema={kitchenStationUpdateSchema} defaults={{ locationId: "", name: "", key: "", sortOrder: 0, isActive: true }}
            writePermission="locations.manage" hardDelete filters={branchFilter} emptyDescription="Stations (Grill, Fryer, Bar) decide which kitchen screen sees each item."
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
