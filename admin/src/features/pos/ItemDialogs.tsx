import { Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { lineForCombo, lineForProduct, money, type CartLine, type MenuCombo, type MenuOption, type MenuProduct, type MenuSlotOption, type MoneyFormat } from "./cart";

function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label={label}>
      <Button type="button" size="icon" variant="outline" aria-label="Decrease" onClick={() => onChange(Math.max(1, value - 1))}><Minus /></Button>
      <span className="w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">{value}</span>
      <Button type="button" size="icon" variant="outline" aria-label="Increase" onClick={() => onChange(Math.min(100, value + 1))}><Plus /></Button>
    </div>
  );
}

const Chip = ({ active, children, onClick, disabled }: { active: boolean; children: React.ReactNode; onClick: () => void; disabled?: boolean }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
    className={`rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent"}`}>
    {children}
  </button>
);

/** Choose a size, the add-ons (respecting each group's minimum and maximum), a quantity and a note. */
export function ItemDialog({ product, fmt, onAdd, onClose }: { product: MenuProduct; fmt: MoneyFormat; onAdd: (line: CartLine) => void; onClose: () => void }) {
  const [variantId, setVariantId] = useState(product.variants.find((v) => v.isDefault)?.id ?? product.variants[0]!.id);
  const [picked, setPicked] = useState<Record<string, string[]>>(() => Object.fromEntries(product.modifierGroups.map((g) => [g.id, g.options.filter((o) => o.isDefault).slice(0, g.maxSelect).map((o) => o.id)])));
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const variant = product.variants.find((v) => v.id === variantId)!;
  const mods = useMemo(() => product.modifierGroups.flatMap((g) => g.options.filter((o) => picked[g.id]?.includes(o.id))), [product, picked]);
  const problems = product.modifierGroups.filter((g) => (picked[g.id]?.length ?? 0) < g.minSelect);
  const unit = variant.priceMinor + mods.reduce((a, m) => a + m.priceMinor, 0);

  const toggle = (groupId: string, optionId: string, max: number) =>
    setPicked((p) => {
      const cur = p[groupId] ?? [];
      if (cur.includes(optionId)) return { ...p, [groupId]: cur.filter((x) => x !== optionId) };
      // a single-choice group swaps the choice instead of refusing a second tap
      return { ...p, [groupId]: max === 1 ? [optionId] : cur.length < max ? [...cur, optionId] : cur };
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product.name}</DialogTitle>
          {product.description && <DialogDescription>{product.description}</DialogDescription>}
        </DialogHeader>

        {product.variants.length > 1 && (
          <section aria-label="Size" className="space-y-2">
            <h3 className="text-sm font-semibold">Size</h3>
            <div className="flex flex-wrap gap-2">{product.variants.map((v) => <Chip key={v.id} active={v.id === variantId} onClick={() => setVariantId(v.id)}>{v.name} <span className="text-muted-foreground">{money(v.priceMinor, fmt)}</span></Chip>)}</div>
          </section>
        )}

        {product.modifierGroups.map((g) => (
          <section key={g.id} aria-label={g.name} className="space-y-2">
            <h3 className="text-sm font-semibold">{g.name} <span className="text-xs font-normal text-muted-foreground">{g.minSelect > 0 ? (g.minSelect === g.maxSelect ? `choose ${g.minSelect}` : `choose ${g.minSelect} to ${g.maxSelect}`) : `optional, up to ${g.maxSelect}`}</span></h3>
            <div className="flex flex-wrap gap-2">
              {g.options.map((o: MenuOption) => {
                const on = picked[g.id]?.includes(o.id) ?? false;
                const full = !on && g.maxSelect > 1 && (picked[g.id]?.length ?? 0) >= g.maxSelect;
                return <Chip key={o.id} active={on} disabled={full} onClick={() => toggle(g.id, o.id, g.maxSelect)}>{o.name}{o.priceMinor > 0 && <span className="text-muted-foreground"> +{money(o.priceMinor, fmt)}</span>}</Chip>;
              })}
            </div>
          </section>
        ))}

        <Input placeholder="Note for the kitchen (optional)" value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} aria-label="Note for the kitchen" />

        <DialogFooter className="items-center sm:justify-between">
          <Stepper value={quantity} onChange={setQuantity} label="Quantity" />
          <Button size="lg" disabled={problems.length > 0} onClick={() => onAdd(lineForProduct(product, variant, mods, quantity, notes))}>
            {problems.length > 0 ? `Choose ${problems[0]!.name}` : `Add  ${money(unit * quantity, fmt)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Pick what goes in each slot of a combo (one choice makes a fixed bundle; several let the customer pick). */
export function ComboDialog({ combo, fmt, onAdd, onClose }: { combo: MenuCombo; fmt: MoneyFormat; onAdd: (line: CartLine) => void; onClose: () => void }) {
  // slot id -> chosen option ids, one entry per unit of the slot (a slot of 2 drinks needs 2 choices)
  const [picked, setPicked] = useState<Record<string, string[]>>(() => Object.fromEntries(combo.slots.map((s) => [s.id, s.options.length === 1 ? Array(s.quantity).fill(s.options[0]!.id) : s.options.filter((o) => o.isDefault).slice(0, s.quantity).map((o) => o.id)])));
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const picks = combo.slots.flatMap((s) => (picked[s.id] ?? []).map((id) => ({ slotId: s.id, option: s.options.find((o) => o.id === id) as MenuSlotOption })));
  const incomplete = combo.slots.find((s) => (picked[s.id]?.length ?? 0) !== s.quantity);
  const unit = combo.priceMinor + picks.reduce((a, p) => a + p.option.upchargeMinor, 0);

  const choose = (slotId: string, optionId: string, quantityNeeded: number) =>
    setPicked((p) => {
      const cur = p[slotId] ?? [];
      if (quantityNeeded === 1) return { ...p, [slotId]: [optionId] };
      return { ...p, [slotId]: cur.length < quantityNeeded ? [...cur, optionId] : [...cur.slice(1), optionId] };
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{combo.name}</DialogTitle>
          <DialogDescription>{combo.description ?? "Choose what goes in the deal."}</DialogDescription>
        </DialogHeader>
        {combo.slots.map((s) => (
          <section key={s.id} aria-label={s.name} className="space-y-2">
            <h3 className="text-sm font-semibold">{s.name}{s.quantity > 1 && <span className="text-xs font-normal text-muted-foreground"> choose {s.quantity}</span>}</h3>
            {s.options.length === 1 ? <p className="text-sm text-muted-foreground">{s.options[0]!.name}{s.quantity > 1 ? ` × ${s.quantity}` : ""}</p> : (
              <div className="flex flex-wrap gap-2">
                {s.options.map((o) => <Chip key={o.id} active={(picked[s.id] ?? []).includes(o.id)} onClick={() => choose(s.id, o.id, s.quantity)}>{o.name}{o.upchargeMinor > 0 && <span className="text-muted-foreground"> +{money(o.upchargeMinor, fmt)}</span>}</Chip>)}
              </div>
            )}
          </section>
        ))}
        <Input placeholder="Note for the kitchen (optional)" value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} aria-label="Note for the kitchen" />
        <DialogFooter className="items-center sm:justify-between">
          <Stepper value={quantity} onChange={setQuantity} label="Quantity" />
          <Button size="lg" disabled={!!incomplete} onClick={() => onAdd(lineForCombo(combo, picks, quantity, notes))}>{incomplete ? `Choose ${incomplete.name}` : `Add  ${money(unit * quantity, fmt)}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
