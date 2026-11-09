import { zodResolver } from "@hookform/resolvers/zod";
import { ORGANIZATION_STATUSES, PLANS, organizationCreateSchema, type OrganizationRow } from "@restoflux/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Check, Copy, Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { fmtDate, fmtDateTime, titleCase } from "@/components/cells";
import { DataTable } from "@/components/data-table/DataTable";
import { useTableState } from "@/components/data-table/useTableState";
import { PageHeader } from "@/components/page/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiError, errorMessage, platformApi } from "@/lib/api";
import { usePlatformInvalidate, usePlatformList } from "@/lib/platform";

export const STATUS_TONE: Record<string, string> = {
  TRIAL: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  ACTIVE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  SUSPENDED: "bg-red-500/15 text-red-700 dark:text-red-400",
};

interface Summary {
  organizations: number; trial: number; active: number; suspended: number; users: number; locations: number; newThisMonth: number; trialsEndingSoon: number;
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Shows a generated password exactly once, with a copy button. */
export function SecretDialog({ open, onClose, title, lines }: { open: boolean; onClose: () => void; title: string; lines: { label: string; value: string }[] }) {
  const [copied, setCopied] = useState(false);
  const text = lines.map((l) => `${l.label}: ${l.value}`).join("\n");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Copy these now. For safety the password is not stored in readable form and cannot be shown again.</DialogDescription>
        </DialogHeader>
        <dl className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
          {lines.map((l) => (
            <div key={l.label} className="flex flex-wrap gap-x-3">
              <dt className="w-24 text-muted-foreground">{l.label}</dt>
              <dd className="font-mono break-all">{l.value}</dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)); }}>
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type CreateForm = { name: string; slug: string; currency: string; plan: (typeof PLANS)[number]; status: "TRIAL" | "ACTIVE"; ownerName: string; ownerEmail: string };

function CreateOrganizationDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (secret: { email: string; password: string; id: string } | null, id: string) => void }) {
  const { register, handleSubmit, setValue, watch, setError, reset, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(organizationCreateSchema as never),
    defaultValues: { name: "", slug: "", currency: "PKR", plan: "standard", status: "TRIAL", ownerName: "", ownerEmail: "" },
  });

  const create = useMutation({
    mutationFn: (v: CreateForm) => platformApi.post<{ data: OrganizationRow; meta?: { ownerEmail: string; ownerPassword: string } }>("/organizations", v),
    onSuccess: (res) => {
      reset();
      onCreated(res.meta ? { email: res.meta.ownerEmail, password: res.meta.ownerPassword, id: res.data.id } : null, res.data.id);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422) {
        for (const [field, msgs] of Object.entries(e.fieldErrors)) setError(field as keyof CreateForm, { message: msgs[0] });
      } else toast.error(errorMessage(e));
    },
  });

  const slugFrom = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const err = (k: keyof CreateForm) => errors[k] && <p className="text-xs text-destructive">{String(errors[k]?.message ?? "Invalid")}</p>;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New organization</DialogTitle>
          <DialogDescription>Creates the company with its default roles and an Owner login. A password is generated for the owner and shown once.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="org-name">Company name</Label>
              <Input id="org-name" {...register("name", { onChange: (e) => setValue("slug", slugFrom(e.target.value)) })} />
              {err("name")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-slug">Web address</Label>
              <Input id="org-slug" {...register("slug")} />
              {err("slug")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-owner">Owner name</Label>
              <Input id="org-owner" {...register("ownerName")} />
              {err("ownerName")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-email">Owner email</Label>
              <Input id="org-email" type="email" {...register("ownerEmail")} />
              {err("ownerEmail")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-currency">Currency</Label>
              <Input id="org-currency" maxLength={3} className="uppercase" {...register("currency", { setValueAs: (v: string) => v.toUpperCase() })} />
              {err("currency")}
            </div>
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select value={watch("plan")} onValueChange={(v) => setValue("plan", v as CreateForm["plan"])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{PLANS.map((p) => <SelectItem key={p} value={p}>{titleCase(p)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Starts as</Label>
              <Select value={watch("status")} onValueChange={(v) => setValue("status", v as CreateForm["status"])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TRIAL">Trial (14 days)</SelectItem>
                  <SelectItem value="ACTIVE">Active (paid)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create organization"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function OrganizationsPage() {
  const navigate = useNavigate();
  const { state, update } = useTableState("-createdAt", ["status"]);
  const list = usePlatformList<OrganizationRow>("/organizations", state);
  const summary = useQuery({ queryKey: ["/platform/organizations", "summary"], queryFn: async () => (await platformApi.get<{ data: Summary }>("/organizations/summary")).data });
  const invalidate = usePlatformInvalidate();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string; id: string } | null>(null);

  const columns: ColumnDef<OrganizationRow, any>[] = [
    {
      accessorKey: "name", header: "Organization", meta: { sortKey: "name", label: "Organization" },
      cell: ({ row }) => (<div><div className="font-medium">{row.original.name}</div><div className="text-xs text-muted-foreground">{row.original.slug}</div></div>),
    },
    {
      accessorKey: "status", header: "Status", meta: { sortKey: "status", label: "Status" },
      cell: ({ row }) => (
        <div>
          <Badge variant="secondary" className={STATUS_TONE[row.original.status]}>{titleCase(row.original.status)}</Badge>
          {row.original.status === "TRIAL" && row.original.trialEndsAt && <div className="mt-0.5 text-xs text-muted-foreground">ends {fmtDate(row.original.trialEndsAt)}</div>}
        </div>
      ),
    },
    { accessorKey: "plan", header: "Plan", meta: { sortKey: "plan", label: "Plan" }, cell: ({ getValue }) => titleCase(getValue()) },
    {
      id: "usage", header: "Usage", meta: { label: "Usage" },
      cell: ({ row }) => {
        const o = row.original;
        return (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {o.counts.brands} brands · {o.counts.locations}{o.maxLocations ? `/${o.maxLocations}` : ""} sites · {o.counts.users}{o.maxUsers ? `/${o.maxUsers}` : ""} users
          </span>
        );
      },
    },
    { accessorKey: "lastActivityAt", header: "Last activity", meta: { label: "Last activity" }, cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{getValue() ? fmtDateTime(getValue()) : "Never"}</span> },
    { accessorKey: "createdAt", header: "Created", meta: { sortKey: "createdAt", label: "Created" }, cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{fmtDate(getValue())}</span> },
  ];

  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Organizations"
        description="Every restaurant company using Restoflux. Open one to change its plan, limits or status."
        actions={<Button onClick={() => setCreating(true)}><Plus /> New organization</Button>}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Organizations" value={s?.organizations ?? "-"} hint={s ? `${s.newThisMonth} new this month` : undefined} />
        <Stat label="Active / on trial" value={s ? `${s.active} / ${s.trial}` : "-"} hint={s && s.trialsEndingSoon ? `${s.trialsEndingSoon} trial(s) end within 7 days` : undefined} />
        <Stat label="Suspended" value={s?.suspended ?? "-"} />
        <Stat label="Active users · sites" value={s ? `${s.users} · ${s.locations}` : "-"} />
      </div>

      <DataTable
        columns={columns} rows={list.data?.data ?? []} total={list.data?.meta.total ?? 0} state={state} onChange={update}
        loading={list.isFetching} error={list.isError ? errorMessage(list.error) : null} onRetry={() => list.refetch()}
        searchPlaceholder="Search name or web address…" exportName="organizations" getRowId={(r) => r.id}
        onRowClick={(r) => navigate(`/platform/organizations/${r.id}`)}
        emptyTitle="No organizations yet" emptyDescription="Create the first one to onboard a restaurant company."
        emptyAction={<Button onClick={() => setCreating(true)}><Building2 /> New organization</Button>}
        filters={
          <Select value={state.filters.status ?? "__all__"} onValueChange={(v) => update({ filters: { status: v === "__all__" ? undefined : v } })}>
            <SelectTrigger size="sm" className="w-40" aria-label="Status"><SelectValue placeholder="All status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All status</SelectItem>
              {ORGANIZATION_STATUSES.map((st) => <SelectItem key={st} value={st}>{titleCase(st)}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      <CreateOrganizationDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (sec, id) => {
          setCreating(false);
          await invalidate("/organizations");
          toast.success("Organization created");
          if (sec) setSecret(sec); else navigate(`/platform/organizations/${id}`);
        }}
      />
      <SecretDialog
        open={!!secret}
        onClose={() => { const id = secret?.id; setSecret(null); if (id) navigate(`/platform/organizations/${id}`); }}
        title="Owner login"
        lines={secret ? [{ label: "Email", value: secret.email }, { label: "Password", value: secret.password }] : []}
      />
    </>
  );
}
