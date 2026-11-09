import { PLANS, type OrganizationRow } from "@restoflux/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { fmtDate, fmtDateTime, titleCase } from "@/components/cells";
import { PageHeader } from "@/components/page/PageHeader";
import { ErrorState, LoadingRows } from "@/components/page/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, errorMessage, platformApi } from "@/lib/api";
import { usePlatformInvalidate } from "@/lib/platform";
import { SecretDialog, STATUS_TONE } from "./OrganizationsPage";

interface Detail extends OrganizationRow {
  owners: { id: string; name: string; email: string; status: string; lastLoginAt: string | null }[];
  recentActions: { id: string; action: string; reason: string | null; occurredAt: string }[];
}

const toNumber = (v: string): number | null => (v.trim() === "" ? null : Number(v));

export default function OrganizationDetailPage() {
  const { id = "" } = useParams();
  const invalidate = usePlatformInvalidate();
  const org = useQuery({ queryKey: [`/platform/organizations`, "detail", id], queryFn: async () => (await platformApi.get<{ data: Detail }>(`/organizations/${id}`)).data });

  const [plan, setPlan] = useState("standard");
  const [maxLocations, setMaxLocations] = useState("");
  const [maxUsers, setMaxUsers] = useState("");
  const [name, setName] = useState("");
  const [trialEnds, setTrialEnds] = useState("");
  useEffect(() => {
    const o = org.data;
    if (!o) return;
    setName(o.name);
    setPlan(o.plan);
    setMaxLocations(o.maxLocations?.toString() ?? "");
    setMaxUsers(o.maxUsers?.toString() ?? "");
    setTrialEnds(o.trialEndsAt ? o.trialEndsAt.slice(0, 10) : "");
  }, [org.data]);

  const [statusDialog, setStatusDialog] = useState<"SUSPENDED" | "ACTIVE" | "TRIAL" | null>(null);
  const [reason, setReason] = useState("");
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [resetting, setResetting] = useState<Detail["owners"][number] | null>(null);

  const refresh = () => invalidate("/organizations", "/audit-logs");

  const save = useMutation({
    mutationFn: () => platformApi.patch(`/organizations/${id}`, {
      name: name.trim(), plan, maxLocations: toNumber(maxLocations), maxUsers: toNumber(maxUsers),
      trialEndsAt: trialEnds ? new Date(`${trialEnds}T23:59:59`).toISOString() : null,
    }),
    onSuccess: async () => { toast.success("Organization updated"); await refresh(); },
    onError: (e) => toast.error(e instanceof ApiError && e.status === 422 ? (Object.values(e.fieldErrors)[0]?.[0] ?? e.message) : errorMessage(e)),
  });

  const setStatus = useMutation({
    mutationFn: (status: "SUSPENDED" | "ACTIVE" | "TRIAL") => platformApi.post(`/organizations/${id}/status`, { status, reason: reason.trim() || undefined }),
    onSuccess: async (_d, status) => { toast.success(status === "SUSPENDED" ? "Organization suspended and signed out" : "Organization reactivated"); setStatusDialog(null); setReason(""); await refresh(); },
    onError: (e) => toast.error(e instanceof ApiError && e.status === 422 ? (Object.values(e.fieldErrors)[0]?.[0] ?? e.message) : errorMessage(e)),
  });

  const reset = useMutation({
    mutationFn: (userId: string) => platformApi.post<{ data: { email: string }; meta?: { password: string } }>(`/organizations/${id}/reset-owner-password`, { userId }),
    onSuccess: async (res) => { setResetting(null); if (res.meta) setSecret({ email: res.data.email, password: res.meta.password }); await refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (org.isPending) return <LoadingRows />;
  if (org.isError) return <ErrorState message={errorMessage(org.error)} onRetry={() => org.refetch()} />;
  const o = org.data;

  return (
    <>
      <Link to="/platform/organizations" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> All organizations</Link>
      <PageHeader
        title={o.name}
        description={<span className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className={STATUS_TONE[o.status]}>{titleCase(o.status)}</Badge><span>{o.slug} · {o.baseCurrency} · created {fmtDate(o.createdAt)}</span></span>}
        actions={
          o.status === "SUSPENDED" ? (
            <Button onClick={() => setStatusDialog("ACTIVE")}><Play /> Reactivate</Button>
          ) : (
            <Button variant="destructive" onClick={() => setStatusDialog("SUSPENDED")}><Pause /> Suspend</Button>
          )
        }
      />
      {o.status === "SUSPENDED" && (
        <div role="status" className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <strong className="text-destructive">Suspended.</strong> Staff cannot sign in. Reason: {o.suspendedReason ?? "not recorded"}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Plan and limits</CardTitle><CardDescription>Leave a limit empty for unlimited. Limits stop new branches or users from being created; nothing existing is removed.</CardDescription></CardHeader>
            <CardContent>
              <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
                <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="o-name">Company name</Label><Input id="o-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1.5">
                  <Label>Plan</Label>
                  <Select value={plan} onValueChange={setPlan}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{PLANS.map((p) => <SelectItem key={p} value={p}>{titleCase(p)}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-1.5"><Label htmlFor="o-trial">Trial ends</Label><Input id="o-trial" type="date" value={trialEnds} onChange={(e) => setTrialEnds(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="o-loc">Max branches and warehouses</Label><Input id="o-loc" type="number" min={1} inputMode="numeric" placeholder="Unlimited" value={maxLocations} onChange={(e) => setMaxLocations(e.target.value)} /><p className="text-xs text-muted-foreground">In use: {o.counts.locations}</p></div>
                <div className="space-y-1.5"><Label htmlFor="o-users">Max users</Label><Input id="o-users" type="number" min={1} inputMode="numeric" placeholder="Unlimited" value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} /><p className="text-xs text-muted-foreground">In use: {o.counts.users}</p></div>
                <div className="sm:col-span-2"><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button></div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Owners</CardTitle><CardDescription>The people who can sign in as the company administrator. If an owner is locked out, reset the password here.</CardDescription></CardHeader>
            <CardContent className="divide-y">
              {o.owners.length === 0 && <p className="text-sm text-muted-foreground">No active owner.</p>}
              {o.owners.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <div><div className="font-medium">{u.name}</div><div className="text-xs text-muted-foreground">{u.email} · last sign-in {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "never"}</div></div>
                  <Button size="sm" variant="outline" onClick={() => setResetting(u)}><KeyRound /> Reset password</Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Usage</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row k="Brands" v={o.counts.brands} />
              <Row k="Branches and warehouses" v={`${o.counts.locations}${o.maxLocations ? ` of ${o.maxLocations}` : ""}`} />
              <Row k="Users" v={`${o.counts.users}${o.maxUsers ? ` of ${o.maxUsers}` : ""}`} />
              <Row k="Last activity" v={o.lastActivityAt ? fmtDateTime(o.lastActivityAt) : "Never"} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recent actions</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {o.recentActions.length === 0 && <p className="text-muted-foreground">Nothing yet.</p>}
              {o.recentActions.map((a) => (
                <div key={a.id}><div className="font-medium">{a.action}</div><div className="text-xs text-muted-foreground">{fmtDateTime(a.occurredAt)}{a.reason ? ` · ${a.reason}` : ""}</div></div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!statusDialog} onOpenChange={(open) => { if (!open) { setStatusDialog(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{statusDialog === "SUSPENDED" ? `Suspend ${o.name}?` : `Reactivate ${o.name}?`}</DialogTitle>
            <DialogDescription>{statusDialog === "SUSPENDED" ? "Everyone in this organization is signed out immediately and cannot sign in until you reactivate it. Their data is kept." : "Staff can sign in again right away."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason{statusDialog === "SUSPENDED" ? " (required)" : " (optional)"}</Label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in the platform audit log" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialog(null)}>Cancel</Button>
            <Button variant={statusDialog === "SUSPENDED" ? "destructive" : "default"} disabled={setStatus.isPending || (statusDialog === "SUSPENDED" && !reason.trim())} onClick={() => statusDialog && setStatus.mutate(statusDialog)}>
              {statusDialog === "SUSPENDED" ? "Suspend organization" : "Reactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetting} onOpenChange={(open) => !open && setResetting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password for {resetting?.name}?</DialogTitle>
            <DialogDescription>A new password is generated and shown once. They are signed out everywhere and must use it to sign in again.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetting(null)}>Cancel</Button>
            <Button disabled={reset.isPending} onClick={() => resetting && reset.mutate(resetting.id)}>{reset.isPending ? "Resetting…" : "Reset password"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SecretDialog open={!!secret} onClose={() => setSecret(null)} title="New owner password" lines={secret ? [{ label: "Email", value: secret.email }, { label: "Password", value: secret.password }] : []} />
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium tabular-nums">{v}</span>
    </div>
  );
}
