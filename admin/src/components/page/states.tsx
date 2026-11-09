import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The three states every page must handle explicitly: empty, loading, error.

export function EmptyState({ title, description, action, icon, className }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center", className)}>
      <div className="text-muted-foreground">{icon ?? <Inbox className="size-8" />}</div>
      <p className="text-base font-semibold">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center", className)}>
      <AlertTriangle className="size-7 text-destructive" />
      <p className="max-w-md text-sm font-medium text-destructive">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function FullPageSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-screen items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}
