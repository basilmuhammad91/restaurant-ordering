import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Can } from "@/components/Can";
import { PageHeader } from "@/components/page/PageHeader";
import { ErrorState, LoadingRows } from "@/components/page/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fromMinor, toMinor, useCurrencies } from "@/lib/money";
import { useInvalidate } from "@/lib/queries";

interface RoleDetail {
  id: string;
  name: string;
  description: string | null;
  isOwner: boolean;
  isSystem: boolean;
  unlimitedLimits: boolean;
  maxDiscountPercent: number;
  permissions: string[];
  userCount: number;
  limits: { currencyCode: string; voidLimitMinor: number; refundLimitMinor: number; poApprovalLimitMinor: number; adjustmentLimitMinor: number }[];
}
interface Group {
  module: string;
  permissions: { key: string; description: string }[];
}
interface LimitRow {
  currencyCode: string;
  void: string;
  refund: string;
  po: string;
  adjustment: string;
}

const LIMIT_FIELDS: { key: keyof Omit<LimitRow, "currencyCode">; label: string; hint: string }[] = [
  { key: "void", label: "Void", hint: "Largest void without approval" },
  { key: "refund", label: "Refund", hint: "Largest refund without approval" },
  { key: "po", label: "Purchase order", hint: "Largest PO this role can approve" },
  { key: "adjustment", label: "Stock adjustment", hint: "Largest stock write-off" },
];

export default function RoleMatrixPage() {
  const { id = "" } = useParams();
  const { can, me } = useAuth();
  const invalidate = useInvalidate();
  const { currencies, exponent } = useCurrencies();

  const role = useQuery({ queryKey: ["/roles", id], queryFn: async () => (await api.get<{ data: RoleDetail }>(`/roles/${id}`)).data });
  const catalog = useQuery({ queryKey: ["/permissions"], queryFn: async () => (await api.get<{ data: Group[] }>("/permissions")).data, staleTime: 3_600_000 });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limits, setLimits] = useState<LimitRow[]>([]);
  const [limitError, setLimitError] = useState<string | null>(null);

  useEffect(() => {
    if (!role.data) return;
    setSelected(new Set(role.data.permissions));
    setLimits(role.data.limits.map((l) => ({
      currencyCode: l.currencyCode, void: fromMinor(l.voidLimitMinor, exponent(l.currencyCode)), refund: fromMinor(l.refundLimitMinor, exponent(l.currencyCode)),
      po: fromMinor(l.poApprovalLimitMinor, exponent(l.currencyCode)), adjustment: fromMinor(l.adjustmentLimitMinor, exponent(l.currencyCode)),
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role.data, currencies.length]);

  const totalPermissions = useMemo(() => (catalog.data ?? []).reduce((n, g) => n + g.permissions.length, 0), [catalog.data]);
  const actorIsOwnerLike = (me?.permissions.length ?? 0) >= totalPermissions && totalPermissions > 0;
  const readOnly = !!role.data?.isOwner || !can("roles.manage");
  // you cannot grant what you do not hold (the API enforces this too; here we just disable the box)
  const canAdd = (key: string) => actorIsOwnerLike || can(key as never);

  const savePerms = useMutation({
    mutationFn: () => api.put(`/roles/${id}/permissions`, { permissions: [...selected] }),
    onSuccess: async () => { toast.success("Permissions saved. They apply to everyone with this role on their next request."); await invalidate("/roles", "/users"); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const saveLimits = useMutation({
    mutationFn: () => {
      const body = limits.map((l) => {
        const exp = exponent(l.currencyCode);
        const v = [toMinor(l.void, exp), toMinor(l.refund, exp), toMinor(l.po, exp), toMinor(l.adjustment, exp)];
        if (v.some((x) => x === null)) throw new Error(`Check the amounts for ${l.currencyCode}: use numbers with at most ${exp} decimals.`);
        return { currencyCode: l.currencyCode, voidLimitMinor: v[0]!, refundLimitMinor: v[1]!, poApprovalLimitMinor: v[2]!, adjustmentLimitMinor: v[3]! };
      });
      return api.put(`/roles/${id}/limits`, { limits: body });
    },
    onSuccess: async () => { setLimitError(null); toast.success("Limits saved"); await invalidate("/roles"); },
    onError: (e) => setLimitError(errorMessage(e)),
  });

  if (role.isError) return <ErrorState message={errorMessage(role.error)} onRetry={() => role.refetch()} />;
  if (!role.data || !catalog.data) return <LoadingRows />;
  const r = role.data;

  const toggleModule = (g: Group, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const p of g.permissions) {
        if (on && canAdd(p.key)) next.add(p.key);
        if (!on) next.delete(p.key);
      }
      return next;
    });

  const unusedCurrencies = currencies.filter((c) => !limits.some((l) => l.currencyCode === c.code));

  return (
    <>
      <PageHeader
        title={r.name}
        description={<span>Permissions and approval limits · {r.userCount} user{r.userCount === 1 ? "" : "s"} · max discount {r.maxDiscountPercent}%</span>}
        actions={<Button variant="outline" asChild><Link to="/settings/roles"><ArrowLeft /> All roles</Link></Button>}
      />

      {r.isOwner && (
        <Alert className="mb-4">
          <AlertTitle>Owner role</AlertTitle>
          <AlertDescription>The owner always holds every permission with unlimited approval authority, so it cannot be reduced.</AlertDescription>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Permission matrix</CardTitle>
          <CardDescription>Tick what this role may do. Changes apply to every user with the role on their next request; the server enforces them whatever the screen shows.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {catalog.data.map((g) => {
            const keys = g.permissions.map((p) => p.key);
            const count = keys.filter((k) => selected.has(k)).length;
            return (
              <div key={g.module} className="rounded-lg border">
                <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                  <label className="flex cursor-pointer items-center gap-2 font-medium">
                    <Checkbox
                      checked={count === keys.length ? true : count === 0 ? false : "indeterminate"}
                      disabled={readOnly}
                      onCheckedChange={(c) => toggleModule(g, c === true)}
                      aria-label={`All ${g.module} permissions`}
                    />
                    {g.module}
                  </label>
                  <Badge variant="secondary">{count} / {keys.length}</Badge>
                </div>
                <div className="grid gap-1 p-3 sm:grid-cols-2">
                  {g.permissions.map((p) => {
                    const on = selected.has(p.key);
                    const locked = readOnly || (!on && !canAdd(p.key));
                    return (
                      <label key={p.key} className={`flex items-start gap-2 rounded px-2 py-1.5 text-sm ${locked ? "opacity-60" : "cursor-pointer hover:bg-accent"}`} title={!on && !canAdd(p.key) ? "You cannot grant a permission you do not hold" : undefined}>
                        <Checkbox className="mt-0.5" checked={on} disabled={locked} onCheckedChange={(c) => setSelected((s) => { const n = new Set(s); if (c) n.add(p.key); else n.delete(p.key); return n; })} />
                        <span>
                          <span className="block leading-tight">{p.description}</span>
                          <code className="text-[11px] text-muted-foreground">{p.key}</code>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <Can permission="roles.manage">
            <div className="flex items-center gap-3">
              <Button onClick={() => savePerms.mutate()} disabled={readOnly || savePerms.isPending}>{savePerms.isPending ? "Saving…" : "Save permissions"}</Button>
              <span className="text-sm text-muted-foreground">{selected.size} of {totalPermissions} selected</span>
            </div>
          </Can>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approval limits</CardTitle>
          <CardDescription>Above these amounts, this role needs a manager's approval (void, refund, purchase order, stock write-off). Limits are per currency: 10,000 rupees and 10,000 dirhams are very different amounts. A currency without a row means everything needs approval.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(r.isOwner || r.unlimitedLimits) ? (
            <p className="text-sm text-muted-foreground">This role has unlimited authority, so limits do not apply.</p>
          ) : (
            <>
              {limitError && <p role="alert" className="text-sm text-destructive">{limitError}</p>}
              {limits.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No limits yet: every void, refund, PO and write-off needs approval.</p>}
              {limits.map((l, i) => (
                <div key={l.currencyCode} className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{l.currencyCode}</Badge>
                    <Button variant="ghost" size="sm" className="text-destructive" disabled={readOnly} onClick={() => setLimits((ls) => ls.filter((_, idx) => idx !== i))}><Trash2 /> Remove</Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-4">
                    {LIMIT_FIELDS.map((f) => (
                      <div key={f.key} className="space-y-1.5">
                        <Label>{f.label}</Label>
                        <Input inputMode="decimal" disabled={readOnly} value={l[f.key]} onChange={(e) => setLimits((ls) => ls.map((x, idx) => (idx === i ? { ...x, [f.key]: e.target.value } : x)))} aria-label={`${f.label} limit in ${l.currencyCode}`} />
                        <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <Can permission="roles.manage">
                <div className="flex flex-wrap items-center gap-2">
                  {unusedCurrencies.length > 0 && (
                    <Select value="" onValueChange={(code) => setLimits((ls) => [...ls, { currencyCode: code, void: "0", refund: "0", po: "0", adjustment: "0" }])}>
                      <SelectTrigger className="w-48" size="sm"><Plus className="size-4" /><SelectValue placeholder="Add a currency" /></SelectTrigger>
                      <SelectContent>{unusedCurrencies.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} - {c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  <Button onClick={() => saveLimits.mutate()} disabled={readOnly || saveLimits.isPending}>{saveLimits.isPending ? "Saving…" : "Save limits"}</Button>
                </div>
              </Can>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
