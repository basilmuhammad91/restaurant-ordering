import type { Deal, OrderStatus } from "./types";

// PKR, shown as "Rs. 1,250" (decimals only when there are paisa, e.g. "Rs. 1,250.50").
export function money(cents: number): string {
  const whole = cents % 100 === 0;
  return `Rs. ${(cents / 100).toLocaleString("en-PK", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

// Compact form for chart axes: "Rs. 1.2K"
export function moneyShort(cents: number): string {
  const rupees = cents / 100;
  if (rupees >= 1_000_000) return `Rs. ${(rupees / 1_000_000).toFixed(1)}M`;
  if (rupees >= 1_000) return `Rs. ${(rupees / 1_000).toFixed(1)}K`;
  return `Rs. ${Math.round(rupees)}`;
}

export const percentOff = (d: Pick<Deal, "dealPriceCents" | "originalPriceCents">) =>
  d.originalPriceCents > 0 ? Math.round((1 - d.dealPriceCents / d.originalPriceCents) * 100) : 0;

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
};

export const statusLabel: Record<OrderStatus, string> = {
  PENDING: "New",
  CONFIRMED: "Confirmed",
  PREPARING: "Preparing",
  READY: "Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const statusClass: Record<OrderStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-sky-100 text-sky-800",
  PREPARING: "bg-orange-100 text-orange-800",
  READY: "bg-emerald-100 text-emerald-800",
  COMPLETED: "bg-stone-200 text-stone-700",
  CANCELLED: "bg-red-100 text-red-700",
};

// Mirrors the API's state machine (api/src/routes/orders.ts). The server is the
// source of truth and re-validates; this just decides which buttons to show.
export const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING: "CONFIRMED",
  CONFIRMED: "PREPARING",
  PREPARING: "READY",
  READY: "COMPLETED",
};
export const canCancel = (s: OrderStatus) => s === "PENDING" || s === "CONFIRMED";
export const isFinal = (s: OrderStatus) => s === "COMPLETED" || s === "CANCELLED";

export const channelLabel = { WEB: "Web", POS: "POS", ANDROID: "Android", IOS: "iOS" } as const;
