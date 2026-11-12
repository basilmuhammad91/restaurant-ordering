import { Badge } from "@/components/ui/badge";
import { useAll } from "@/lib/queries";

export interface Supplier { id: string; name: string; code: string | null; contactName: string | null; phone: string | null; email: string | null; address: string | null; taxId: string | null; paymentTermsDays: number; notes: string | null; isActive: boolean; deletedAt: string | null }

export const useSuppliers = () => useAll<Supplier>("/suppliers", { isActive: true });

const PO_LABEL: Record<string, string> = { DRAFT: "Draft", APPROVED: "Approved", SENT: "Sent", PARTIALLY_RECEIVED: "Part received", RECEIVED: "Received", CANCELLED: "Cancelled" };
const PO_TONE: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground", APPROVED: "bg-sky-500/15 text-sky-700 dark:text-sky-400", SENT: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  PARTIALLY_RECEIVED: "bg-amber-500/15 text-amber-700 dark:text-amber-400", RECEIVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", CANCELLED: "bg-red-500/15 text-red-700 dark:text-red-400",
};
export const PO_STATUSES = Object.entries(PO_LABEL).map(([value, label]) => ({ value, label }));
export const PoBadge = ({ status }: { status: string }) => <Badge variant="secondary" className={PO_TONE[status]}>{PO_LABEL[status] ?? status}</Badge>;

const INV_LABEL: Record<string, string> = { OPEN: "Unpaid", PARTIALLY_PAID: "Part paid", PAID: "Paid", VOID: "Void" };
const INV_TONE: Record<string, string> = {
  OPEN: "bg-amber-500/15 text-amber-700 dark:text-amber-400", PARTIALLY_PAID: "bg-sky-500/15 text-sky-700 dark:text-sky-400", PAID: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", VOID: "bg-muted text-muted-foreground",
};
export const INV_STATUSES = Object.entries(INV_LABEL).map(([value, label]) => ({ value, label }));
export const InvoiceBadge = ({ status, overdue }: { status: string; overdue?: boolean }) => (
  <span className="inline-flex items-center gap-1.5">
    <Badge variant="secondary" className={INV_TONE[status]}>{INV_LABEL[status] ?? status}</Badge>
    {overdue && <Badge variant="secondary" className="bg-red-500/15 text-red-700 dark:text-red-400">Overdue</Badge>}
  </span>
);
