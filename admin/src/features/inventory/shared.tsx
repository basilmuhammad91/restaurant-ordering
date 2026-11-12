import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { SimpleSelect } from "@/features/menu/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinor, useCurrencies } from "@/lib/money";

// Small pieces every inventory screen shares: the lists a picker needs, a location chooser, quantity and money formatting.

export interface InvItem { id: string; name: string; unit: string; kind: string; sku: string | null }
export interface MenuItemOption { id: string; label: string }
export const UNIT_OPTIONS = ["kg", "g", "l", "ml", "pcs"].map((u) => ({ value: u, label: u }));
export const KIND_OPTIONS = [{ value: "RAW", label: "Ingredient" }, { value: "PREP", label: "Prep item (made in-house)" }, { value: "PACKAGING", label: "Packaging" }];
export const KIND_LABEL: Record<string, string> = { RAW: "Ingredient", PREP: "Prep item", PACKAGING: "Packaging" };

/** Every active item and every menu item that can have a recipe, in one request. */
export function useInvOptions() {
  const q = useQuery({
    queryKey: ["/inventory", "options"], staleTime: 30_000,
    queryFn: async () => (await api.get<{ data: { items: InvItem[]; menuItems: MenuItemOption[] } }>("/inventory/options")).data,
  });
  return { items: q.data?.items ?? [], menuItems: q.data?.menuItems ?? [], isLoading: q.isLoading };
}

/** Branches, warehouses and kitchens this person can reach. */
export function useStockLocations() {
  const { me } = useAuth();
  // branches in the organization's own currency first, so a screen opens on the place most people mean
  const base = me?.tenant.baseCurrency;
  return [...(me?.locations ?? [])].sort((x, y) => Number(y.currencyCode === base) - Number(x.currencyCode === base) || x.name.localeCompare(y.name));
}

/** The chosen location, starting on the first one available. */
export function useLocationChoice(initial?: string) {
  const locations = useStockLocations();
  const [picked, setPicked] = useState(initial ?? "");
  const locationId = locations.some((l) => l.id === picked) ? picked : locations[0]?.id ?? "";
  return { locationId, setLocationId: setPicked, locations, location: locations.find((l) => l.id === locationId) };
}

export function LocationSelect({ value, onChange, locations, className = "w-56", label = "Location" }: { value: string; onChange: (v: string) => void; locations: { id: string; name: string; type: string }[]; className?: string; label?: string }) {
  const TYPE: Record<string, string> = { BRANCH: "", WAREHOUSE: " (warehouse)", CENTRAL_KITCHEN: " (kitchen)" };
  return <SimpleSelect className={className} value={value} onChange={onChange} label={label} options={locations.map((l) => ({ value: l.id, label: `${l.name}${TYPE[l.type] ?? ""}` }))} />;
}

/** 2.5 -> "2.5", 1200 -> "1,200", never more than 3 decimals. */
export const fmtQty = (n: number) => Number(n.toFixed(3)).toLocaleString("en");

/** Format money for a location's currency, from minor units that may carry a fraction. */
export function useMoney(currencyCode: string | undefined) {
  const { exponent } = useCurrencies();
  const code = currencyCode ?? "USD";
  const exp = exponent(code);
  return { code, exp, money: (minor: number) => formatMinor(Math.round(minor), code, exp), toMajor: (minor: number) => Number((minor / 10 ** exp).toFixed(Math.max(exp, 2))), toMinor: (major: number) => major * 10 ** exp };
}

export const MOVE_LABEL: Record<string, string> = {
  OPENING: "Opening stock", PURCHASE: "Purchase", SALE: "Sale", SALE_REVERSAL: "Sale reversed", ADJUSTMENT: "Correction", WASTE: "Waste", EXPIRED: "Expired", DAMAGE: "Damaged",
  STAFF_MEAL: "Staff meal", COUNT: "Count", TRANSFER_OUT: "Sent", TRANSFER_IN: "Received", PRODUCTION_IN: "Produced", PRODUCTION_OUT: "Used in production",
};
const MOVE_TONE: Record<string, string> = {
  WASTE: "bg-red-500/15 text-red-700 dark:text-red-400", EXPIRED: "bg-red-500/15 text-red-700 dark:text-red-400", DAMAGE: "bg-red-500/15 text-red-700 dark:text-red-400",
  STAFF_MEAL: "bg-amber-500/15 text-amber-700 dark:text-amber-400", COUNT: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  PURCHASE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", OPENING: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", PRODUCTION_IN: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};
export const MoveBadge = ({ type }: { type: string }) => <Badge variant="secondary" className={MOVE_TONE[type]}>{MOVE_LABEL[type] ?? type}</Badge>;

export const DOC_TONE: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground", SUBMITTED: "bg-amber-500/15 text-amber-700 dark:text-amber-400", APPROVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  CANCELLED: "bg-red-500/15 text-red-700 dark:text-red-400", REQUESTED: "bg-amber-500/15 text-amber-700 dark:text-amber-400", IN_TRANSIT: "bg-sky-500/15 text-sky-700 dark:text-sky-400", RECEIVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};
export const DocBadge = ({ status }: { status: string }) => <Badge variant="secondary" className={DOC_TONE[status]}>{status === "IN_TRANSIT" ? "In transit" : status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
