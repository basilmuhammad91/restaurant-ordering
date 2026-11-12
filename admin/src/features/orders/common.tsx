import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";

export const STATUS_LABEL: Record<string, string> = {
  OPEN: "Held", PENDING: "New", CONFIRMED: "Confirmed", PREPARING: "Preparing", READY: "Ready", OUT_FOR_DELIVERY: "Out for delivery", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
export const STATUS_TONE: Record<string, string> = {
  OPEN: "bg-muted text-muted-foreground", PENDING: "bg-amber-500/15 text-amber-700 dark:text-amber-400", CONFIRMED: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  PREPARING: "bg-violet-500/15 text-violet-700 dark:text-violet-400", READY: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  OUT_FOR_DELIVERY: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400", COMPLETED: "bg-muted text-foreground", CANCELLED: "bg-red-500/15 text-red-700 dark:text-red-400",
};
export const PAYMENT_LABEL: Record<string, string> = { UNPAID: "Unpaid", PARTIAL: "Part paid", PAID: "Paid", REFUNDED: "Refunded", PARTIALLY_REFUNDED: "Part refunded" };
export const PAYMENT_TONE: Record<string, string> = {
  UNPAID: "bg-amber-500/15 text-amber-700 dark:text-amber-400", PARTIAL: "bg-amber-500/15 text-amber-700 dark:text-amber-400", PAID: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  REFUNDED: "bg-red-500/15 text-red-700 dark:text-red-400", PARTIALLY_REFUNDED: "bg-red-500/15 text-red-700 dark:text-red-400",
};
export const TYPE_LABEL: Record<string, string> = { DINE_IN: "Dine-in", TAKEAWAY: "Takeaway", DELIVERY: "Delivery" };

export const StatusBadge = ({ status }: { status: string }) => <Badge variant="secondary" className={STATUS_TONE[status]}>{STATUS_LABEL[status] ?? status}</Badge>;
export const PaymentBadge = ({ status }: { status: string }) => <Badge variant="secondary" className={PAYMENT_TONE[status]}>{PAYMENT_LABEL[status] ?? status}</Badge>;

/** Branches the signed-in user can work in. */
export function useBranches() {
  const { me } = useAuth();
  return (me?.locations ?? []).filter((l) => l.type === "BRANCH");
}

/** Minutes since a moment, re-rendered every 20 seconds (for ticket timers). */
export function useMinutesSince(iso: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}
