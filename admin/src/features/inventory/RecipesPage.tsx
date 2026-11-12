import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/page/PageHeader";
import { ErrorState } from "@/components/page/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SimpleSelect } from "@/features/menu/shared";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useInvalidate } from "@/lib/queries";
import { fmtQty, useInvOptions, useMoney } from "./shared";

interface RecipeRow { id: string; kind: "menu" | "prep"; variantId: string | null; prepItemId: string | null; targetName: string; yieldQty: number; unit: string | null; ingredients: number; costPerUnitMinor: number; isActive: boolean }
interface Line { itemId: string; qty: string; wastePercent: string }

/** What each menu item (or batch of a prep item) is made from, and what that costs. Selling an item takes these ingredients out of stock. */
export default function RecipesPage() {
  const { me, can } = useAuth();
  const { money } = useMoney(me?.tenant.baseCurrency);
  const invalidate = useInvalidate();
  const [kind, setKind] = useState<"menu" | "prep">("menu");
  const [editing, setEditing] = useState<RecipeRow | "new" | null>(null);
  const [removing, setRemoving] = useState<RecipeRow | null>(null);
  const list = useQuery({ queryKey: ["/recipes", kind], queryFn: async () => (await api.get<{ data: RecipeRow[] }>("/recipes", { kind })).data });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/recipes/${id}`),
    onSuccess: async () => { toast.success("Recipe removed"); setRemoving(null); await invalidate("/recipes"); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader title="Recipes" description="List the ingredients for each dish. Stock comes off automatically when an order is completed, and the cost shows what each portion really costs you."
        actions={can("recipes.manage") ? <Button onClick={() => setEditing("new")}><Plus /> New recipe</Button> : undefined} />
      <div className="mb-3 inline-flex rounded-lg border p-0.5" role="tablist">
        {([["menu", "Menu items"], ["prep", "Prep batches"]] as const).map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`rounded-md px-3 py-1.5 text-sm ${kind === k ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{label}</button>)}
      </div>
      {list.isError ? <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} /> : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>{kind === "menu" ? "Menu item" : "Prep item"}</TableHead><TableHead className="text-right">Ingredients</TableHead>{kind === "prep" && <TableHead className="text-right">Makes</TableHead>}<TableHead className="text-right">{kind === "menu" ? "Cost per portion" : "Cost per unit"}</TableHead><TableHead className="w-32" /></TableRow></TableHeader>
            <TableBody>
              {list.isPending ? [0, 1, 2].map((i) => <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)
                : (list.data ?? []).length === 0 ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No recipes yet. Without one, selling an item does not use any stock.</TableCell></TableRow>
                : list.data!.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.targetName}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.ingredients}</TableCell>
                    {kind === "prep" && <TableCell className="text-right tabular-nums">{fmtQty(r.yieldQty)} {r.unit}</TableCell>}
                    <TableCell className="text-right tabular-nums">{money(r.costPerUnitMinor)}</TableCell>
                    <TableCell className="text-right">{can("recipes.manage") && <><Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button><Button size="sm" variant="ghost" aria-label="Remove recipe" onClick={() => setRemoving(r)}><Trash2 className="size-4" /></Button></>}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && <RecipeDialog kind={kind} recipe={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {removing && <ConfirmDialog open title={`Remove the recipe for ${removing.targetName}?`} description="Selling it will stop using stock. Past orders are not changed." confirmLabel="Remove" destructive onConfirm={() => remove.mutate(removing.id)} onOpenChange={(o) => !o && setRemoving(null)} />}
    </>
  );
}

function RecipeDialog({ kind: initialKind, recipe, onClose }: { kind: "menu" | "prep"; recipe: RecipeRow | null; onClose: () => void }) {
  const { items, menuItems } = useInvOptions();
  const invalidate = useInvalidate();
  const [kind, setKind] = useState<"menu" | "prep">(recipe?.kind ?? initialKind);
  const [target, setTarget] = useState(recipe?.variantId ?? recipe?.prepItemId ?? "");
  const [yieldQty, setYieldQty] = useState(String(recipe?.yieldQty ?? 1));
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "", wastePercent: "0" }]);
  const detail = useQuery({
    queryKey: ["/recipes", "one", recipe?.id], enabled: !!recipe,
    queryFn: async () => (await api.get<{ data: { cost: { lines: { itemId: string; qty: number; wastePercent: number }[] } | null } }>(`/recipes/${recipe!.id}`)).data,
  });
  const [loaded, setLoaded] = useState(false);
  if (recipe && detail.data?.cost && !loaded) {
    setLoaded(true);
    setLines(detail.data.cost.lines.map((l) => ({ itemId: l.itemId, qty: String(l.qty), wastePercent: String(l.wastePercent) })));
  }
  const prepItems = items.filter((i) => i.kind === "PREP");
  const ingredients = items.filter((i) => i.id !== target);
  const unitOf = (id: string) => items.find((i) => i.id === id)?.unit ?? "";
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const valid = !!target && lines.length > 0 && lines.every((l) => l.itemId && Number(l.qty) > 0);

  const save = useMutation({
    mutationFn: () => api.put("/recipes", {
      ...(kind === "menu" ? { variantId: target } : { prepItemId: target, yieldQty: Number(yieldQty) }),
      lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), wastePercent: Number(l.wastePercent) || 0 })),
    }),
    onSuccess: async () => { toast.success("Recipe saved"); await invalidate("/recipes"); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{recipe ? "Edit recipe" : "New recipe"}</DialogTitle><DialogDescription>{kind === "menu" ? "Ingredients for ONE portion as sold." : "Ingredients for the whole batch, and how much it makes."}</DialogDescription></DialogHeader>
        {!recipe && (
          <div className="inline-flex w-fit rounded-lg border p-0.5">
            {([["menu", "Menu item"], ["prep", "Prep item"]] as const).map(([k, label]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setTarget(""); }} className={`rounded-md px-3 py-1.5 text-sm ${kind === k ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{label}</button>)}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>{kind === "menu" ? "Menu item" : "Prep item"}</Label><SimpleSelect value={target} onChange={setTarget} label="Target" disabled={!!recipe}
            options={kind === "menu" ? menuItems.map((m) => ({ value: m.id, label: m.label })) : prepItems.map((p) => ({ value: p.id, label: p.name }))} placeholder={kind === "prep" && prepItems.length === 0 ? "Add a prep item first" : "Choose…"} /></div>
          {kind === "prep" && <div className="space-y-1.5"><Label htmlFor="yield">Batch makes ({unitOf(target) || "units"})</Label><Input id="yield" inputMode="decimal" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} /></div>}
        </div>
        <div className="space-y-2">
          <Label>Ingredients</Label>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_5rem_2rem] items-center gap-2">
              <SimpleSelect value={l.itemId} onChange={(v) => setLine(i, { itemId: v })} label={`Ingredient ${i + 1}`} options={ingredients.map((x) => ({ value: x.id, label: x.name }))} placeholder="Ingredient" />
              <div className="relative"><Input inputMode="decimal" aria-label="Quantity" placeholder="Qty" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} className="pr-9" /><span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{unitOf(l.itemId)}</span></div>
              <div className="relative"><Input inputMode="decimal" aria-label="Waste percent" placeholder="0" value={l.wastePercent} onChange={(e) => setLine(i, { wastePercent: e.target.value })} className="pr-6" /><span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span></div>
              <Button type="button" size="icon" variant="ghost" aria-label="Remove ingredient" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <div className="flex items-center justify-between"><Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { itemId: "", qty: "", wastePercent: "0" }])}><Plus /> Add ingredient</Button><Badge variant="secondary">Waste % covers trimming and cooking loss</Badge></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>Save recipe</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
