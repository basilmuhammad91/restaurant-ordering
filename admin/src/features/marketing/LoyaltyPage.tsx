import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useMoney } from "@/features/inventory/shared";
import { api, errorMessage, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useInvalidate } from "@/lib/queries";

interface Program { isEnabled: boolean; earnPerPointMinor: number; redeemValueMinor: number; minRedeemPoints: number }

/** How customers earn points and what a point is worth. Points are earned on completed orders, from the customer's phone number. */
export default function LoyaltyPage() {
  const { me, can } = useAuth();
  const { code, exp, money, toMajor } = useMoney(me?.tenant.baseCurrency);
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: ["/loyalty", "program"], queryFn: async () => (await api.get<{ data: Program }>("/loyalty/program")).data });
  const top = useQuery({ queryKey: ["/customers", "top"], queryFn: async () => (await api.get<Paged<{ id: string; name: string; phone: string | null; loyaltyPoints: number }>>("/customers", { sort: "-loyaltyPoints", pageSize: 8 })).data });
  const [form, setForm] = useState<{ isEnabled: boolean; earn: string; redeem: string; min: string } | null>(null);
  const p = q.data;
  if (p && !form) setForm({ isEnabled: p.isEnabled, earn: String(toMajor(p.earnPerPointMinor)), redeem: String(toMajor(p.redeemValueMinor)), min: String(p.minRedeemPoints) });
  const toMinor = (v: string) => Math.round(Number(v) * 10 ** exp);
  const editable = can("loyalty.manage");

  const save = useMutation({
    mutationFn: () => api.put("/loyalty/program", { isEnabled: form!.isEnabled, earnPerPointMinor: toMinor(form!.earn), redeemValueMinor: toMinor(form!.redeem), minRedeemPoints: Number(form!.min) }),
    onSuccess: async () => { toast.success("Loyalty programme saved"); await invalidate("/loyalty"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const valid = form && Number(form.earn) > 0 && Number(form.redeem) > 0 && Number(form.min) >= 1;
  const example = form && Number(form.earn) > 0 ? Math.floor(5000 / Number(form.earn)) : 0;

  return (
    <>
      <PageHeader title="Loyalty" description="Reward regulars. Points are earned on the net amount of each completed order." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Programme</CardTitle><CardDescription>All amounts are in {code}, your organization's currency. Orders in other currencies do not earn points.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {!form ? <Skeleton className="h-40 w-full" /> : (
              <>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2"><Label htmlFor="ly-on" className="cursor-pointer">Loyalty programme is on</Label><Switch id="ly-on" checked={form.isEnabled} disabled={!editable} onCheckedChange={(v) => setForm({ ...form, isEnabled: v })} /></div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5"><Label htmlFor="ly-earn">Spend per point ({code})</Label><Input id="ly-earn" inputMode="decimal" disabled={!editable} value={form.earn} onChange={(e) => setForm({ ...form, earn: e.target.value })} /><p className="text-xs text-muted-foreground">{example > 0 ? `A ${money(5000 * 10 ** (exp - 2))} order earns ${example} point${example === 1 ? "" : "s"}.` : ""}</p></div>
                  <div className="space-y-1.5"><Label htmlFor="ly-val">One point is worth ({code})</Label><Input id="ly-val" inputMode="decimal" disabled={!editable} value={form.redeem} onChange={(e) => setForm({ ...form, redeem: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label htmlFor="ly-min">Minimum to redeem (points)</Label><Input id="ly-min" inputMode="numeric" disabled={!editable} value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} /></div>
                </div>
                {editable && <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>Save programme</Button>}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Most points</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(top.data ?? []).filter((c) => c.loyaltyPoints > 0).length === 0 ? <p className="text-muted-foreground">Nobody has points yet.</p> : (top.data ?? []).filter((c) => c.loyaltyPoints > 0).map((c) => <div key={c.id} className="flex justify-between"><span>{c.name}</span><span className="font-semibold tabular-nums">{c.loyaltyPoints}</span></div>)}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
