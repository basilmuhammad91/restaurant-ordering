import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, type Cursored } from "@/lib/api";
import { useInvalidate } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  type: string;
  severity: "INFO" | "WARN" | "CRITICAL";
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

const dot = { INFO: "bg-sky-500", WARN: "bg-amber-500", CRITICAL: "bg-red-500" } as const;

function timeAgo(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

/** The bell: unread count and the latest notifications (alerts, approvals). Polls every 30 s. */
export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const q = useQuery({
    queryKey: ["/notifications", "bell"],
    queryFn: () => api.get<Cursored<Notification>>("/notifications", { limit: 10 }),
    refetchInterval: 30_000,
  });
  const unread = q.data?.meta.unreadCount ?? 0;

  const markRead = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: () => invalidate("/notifications") });
  const markAll = useMutation({ mutationFn: () => api.post("/notifications/read-all"), onSuccess: () => invalidate("/notifications") });

  const openItem = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id);
    setOpen(false);
    if (n.entityType === "ApprovalRequest") navigate("/approvals");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell />
          {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground">{unread > 99 ? "99+" : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <Button variant="ghost" size="sm" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {q.isError && <p className="p-4 text-sm text-destructive">Could not load notifications.</p>}
          {q.data && q.data.data.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">You're all caught up.</p>}
          {q.data?.data.map((n) => (
            <button key={n.id} type="button" onClick={() => openItem(n)} className={cn("flex w-full gap-3 border-b px-3 py-2.5 text-left text-sm last:border-0 hover:bg-accent", !n.readAt && "bg-accent/40")}>
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot[n.severity], n.readAt && "opacity-30")} />
              <span className="min-w-0">
                <span className={cn("block truncate", !n.readAt && "font-semibold")}>{n.title}</span>
                {n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}
                <span className="block text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
