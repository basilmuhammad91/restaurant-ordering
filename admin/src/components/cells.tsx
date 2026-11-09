import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

export const fmtDateTime = (iso: string | null | undefined) => (iso ? format(new Date(iso), "d MMM yyyy, HH:mm") : "-");
export const fmtDate = (iso: string | null | undefined) => (iso ? format(new Date(iso), "d MMM yyyy") : "-");

export function DateCell({ value }: { value: string | null | undefined }) {
  return <span className="whitespace-nowrap text-muted-foreground">{fmtDate(value)}</span>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Active</Badge> : <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>;
}

export const Mono = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;

export const titleCase = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
