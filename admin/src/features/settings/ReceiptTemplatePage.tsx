import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useInvalidate } from "@/lib/queries";

export interface ReceiptTemplate { headerText: string | null; footerText: string | null; showTaxBreakdown: boolean; showCustomer: boolean; showCashier: boolean }

/** The words and options on every printed receipt. Receipts print this for all branches. */
export default function ReceiptTemplatePage() {
  const { me, can } = useAuth();
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: ["/settings", "receipt"], queryFn: async () => (await api.get<{ data: ReceiptTemplate }>("/settings/receipt")).data });
  const [form, setForm] = useState<ReceiptTemplate | null>(null);
  if (q.data && !form) setForm(q.data);
  const editable = can("settings.manage");
  const save = useMutation({
    mutationFn: () => api.put("/settings/receipt", { headerText: form!.headerText?.trim() || null, footerText: form!.footerText?.trim() || null, showTaxBreakdown: form!.showTaxBreakdown, showCustomer: form!.showCustomer, showCashier: form!.showCashier }),
    onSuccess: async () => { toast.success("Receipt saved"); await invalidate("/settings"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (patch: Partial<ReceiptTemplate>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const brand = me?.tenant.name ?? "Your restaurant";

  return (
    <>
      <PageHeader title="Receipt template" description="What customers see at the top and bottom of their receipt, and which details are shown." />
      {!form ? <Skeleton className="h-72 w-full" /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Content</CardTitle><CardDescription>Short and plain works best on a narrow printer.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="rc-head">Header (under the name)</Label><Textarea id="rc-head" rows={3} disabled={!editable} value={form.headerText ?? ""} onChange={(e) => set({ headerText: e.target.value })} placeholder={"Address, phone number, tax number…"} /></div>
              <div className="space-y-1.5"><Label htmlFor="rc-foot">Footer</Label><Textarea id="rc-foot" rows={3} disabled={!editable} value={form.footerText ?? ""} onChange={(e) => set({ footerText: e.target.value })} placeholder="Thank you! Wi-Fi password…" /></div>
              {([["showTaxBreakdown", "Show the tax breakdown"], ["showCustomer", "Show the customer's name and phone"], ["showCashier", "Show who served the order"]] as const).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between rounded-lg border px-3 py-2"><Label htmlFor={`rc-${k}`} className="cursor-pointer">{label}</Label><Switch id={`rc-${k}`} disabled={!editable} checked={form[k]} onCheckedChange={(v) => set({ [k]: v })} /></div>
              ))}
              {editable && <Button disabled={save.isPending} onClick={() => save.mutate()}>Save receipt</Button>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Preview</CardTitle><CardDescription>A sample order.</CardDescription></CardHeader>
            <CardContent>
              <div className="mx-auto w-72 rounded border bg-white p-4 font-mono text-xs text-black shadow-sm">
                <div className="text-center text-sm font-bold">{brand}</div>
                {form.headerText && <div className="mt-1 whitespace-pre-line text-center">{form.headerText}</div>}
                <div className="my-2 border-t border-dashed" />
                <div>Order KH-0042 · Takeaway</div>
                {form.showCashier && <div>Served by Ayesha</div>}
                {form.showCustomer && <div>Customer: Hira, 0300 555 0000</div>}
                <div className="my-2 border-t border-dashed" />
                <div className="flex justify-between"><span>2 x Chicken Tikka</span><span>1,040</span></div>
                <div className="flex justify-between"><span>1 x Lassi</span><span>180</span></div>
                <div className="my-2 border-t border-dashed" />
                <div className="flex justify-between"><span>Subtotal</span><span>1,220</span></div>
                {form.showTaxBreakdown && <div className="flex justify-between"><span>GST 13%</span><span>159</span></div>}
                <div className="flex justify-between text-sm font-bold"><span>Total</span><span>1,379</span></div>
                {form.footerText && <><div className="my-2 border-t border-dashed" /><div className="whitespace-pre-line text-center">{form.footerText}</div></>}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
