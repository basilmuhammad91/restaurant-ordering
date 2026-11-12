import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/features/menu/shared";
import { api, errorMessage } from "@/lib/api";
import { useInvalidate } from "@/lib/queries";
import { LocationSelect, useInvOptions, useMoney, useStockLocations } from "./shared";

const TYPES = [
  { value: "WASTE", label: "Waste", help: "Spoiled, dropped, over-prepared." },
  { value: "EXPIRED", label: "Expired", help: "Past its date." },
  { value: "DAMAGE", label: "Damaged", help: "Broken or unusable." },
  { value: "STAFF_MEAL", label: "Staff meal", help: "Eaten by the team." },
  { value: "ADJUSTMENT", label: "Correction", help: "Fix a wrong quantity (plus or minus). A reason is required." },
  { value: "OPENING", label: "Opening stock", help: "Stock you already had when you started using the system." },
] as const;

/** Take stock out (waste and friends), put opening stock in, or correct a quantity. One ledger row, with a reason. */
export function AdjustDialog({ locationId: initialLocation, item, onClose }: { locationId: string; item?: { id: string; name: string; unit: string }; onClose: () => void }) {
  const { items } = useInvOptions();
  const locations = useStockLocations();
  const invalidate = useInvalidate();
  const [locationId, setLocationId] = useState(initialLocation);
  const [itemId, setItemId] = useState(item?.id ?? "");
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("WASTE");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = items.find((i) => i.id === itemId) ?? item;
  const location = locations.find((l) => l.id === locationId);
  const { toMinor, code } = useMoney(location?.currencyCode);
  const n = Number(qty);
  const problem = !itemId ? "Choose an item" : !(Number.isFinite(n) && n !== 0 && (type === "ADJUSTMENT" || n > 0)) ? "Enter a quantity" : type === "ADJUSTMENT" && !reason.trim() ? "Say why" : null;

  const save = async () => {
    setBusy(true);
    try {
      await api.post("/inventory/adjustments", { locationId, itemId, type, qty: n, reason: reason.trim() || null, ...(type === "OPENING" && cost ? { unitCost: toMinor(Number(cost)) } : {}) });
      toast.success("Stock updated");
      await invalidate("/inventory");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Adjust stock</DialogTitle><DialogDescription>Every change is recorded in the stock ledger with who made it and why.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Location</Label><LocationSelect className="w-full" value={locationId} onChange={setLocationId} locations={locations} /></div>
          <div className="space-y-1.5"><Label>Item</Label><SimpleSelect value={itemId} onChange={setItemId} label="Item" disabled={!!item} options={(item ? [{ id: item.id, name: item.name }] : items).map((i) => ({ value: i.id, label: i.name }))} placeholder="Choose an item" /></div>
        </div>
        <div className="space-y-1.5">
          <Label>What happened</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type">{TYPES.map((t) => <button key={t.value} type="button" role="radio" aria-checked={type === t.value} onClick={() => setType(t.value)} className={`rounded-lg border px-3 py-1.5 text-sm ${type === t.value ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>{t.label}</button>)}</div>
          <p className="text-xs text-muted-foreground">{TYPES.find((t) => t.value === type)?.help}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="adj-qty">Quantity{selected ? ` (${selected.unit})` : ""}{type === "ADJUSTMENT" ? " (negative to remove)" : ""}</Label><Input id="adj-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></div>
          {type === "OPENING" ? <div className="space-y-1.5"><Label htmlFor="adj-cost">Cost per {selected?.unit ?? "unit"} ({code})</Label><Input id="adj-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
            : <div className="space-y-1.5"><Label htmlFor="adj-reason">Reason{type === "ADJUSTMENT" ? "" : " (optional)"}</Label><Input id="adj-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></div>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!!problem || busy} onClick={() => void save()}>{problem ?? "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
