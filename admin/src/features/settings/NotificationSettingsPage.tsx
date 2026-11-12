import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/page/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { useInvalidate } from "@/lib/queries";

interface Pref { type: string; label: string; help: string; inApp: boolean }

/** Choose which alerts reach your own notification bell. This only changes what you see, not what other people see. */
export default function NotificationSettingsPage() {
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: ["/settings", "notifications"], queryFn: async () => (await api.get<{ data: Pref[] }>("/settings/notifications")).data });
  const save = useMutation({
    mutationFn: (p: { type: string; inApp: boolean }) => api.put("/settings/notifications", { preferences: [p] }),
    onSuccess: async () => { await invalidate("/settings", "/notifications"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <PageHeader title="Notifications" description="Pick the alerts you want in your bell. They only appear for you if your role lets you act on them." />
      <Card className="max-w-2xl">
        <CardHeader><CardTitle className="text-base">Alerts in the app</CardTitle><CardDescription>Email alerts are not available yet.</CardDescription></CardHeader>
        <CardContent className="divide-y">
          {!q.data ? <Skeleton className="h-40 w-full" /> : q.data.map((p) => (
            <div key={p.type} className="flex items-center justify-between gap-4 py-3">
              <div><div className="font-medium">{p.label}</div><div className="text-sm text-muted-foreground">{p.help}</div></div>
              <Switch aria-label={p.label} checked={p.inApp} onCheckedChange={(v) => save.mutate({ type: p.type, inApp: v })} />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
