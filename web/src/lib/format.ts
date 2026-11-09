import type { OrderStatus } from "./types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const money = (cents: number) => usd.format(cents / 100);

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export const statusLabel: Record<OrderStatus, string> = {
  PENDING: "Pending",
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
