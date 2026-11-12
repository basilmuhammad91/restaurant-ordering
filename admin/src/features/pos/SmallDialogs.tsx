import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { toMinor } from "@/lib/money";
import { toast } from "sonner";
import type { MoneyFormat } from "./cart";

/** Start the till's cash shift with an opening float. */
export function OpenShiftDialog({ locationId, fmt, onOpened, onClose }: { locationId: string; fmt: MoneyFormat; onOpened: () => void; onClose: () => void }) {
  const [float, setFloat] = useState("0");
  const [busy, setBusy] = useState(false);
  const minor = toMinor(float, fmt.exponent);
  const open = async () => {
    if (minor === null) return;
    setBusy(true);
    try {
      await api.post("/shifts/open", { locationId, openingFloatMinor: minor });
      toast.success("Shift opened");
      onOpened();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Open shift</DialogTitle><DialogDescription>Count the cash in the drawer and enter it as the opening float. Cash payments need an open shift.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label htmlFor="float">Opening float ({fmt.symbol})</Label><Input id="float" inputMode="decimal" autoFocus className="h-12 text-xl" value={float} onChange={(e) => setFloat(e.target.value)} /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || minor === null} onClick={() => void open()}>{busy ? "Opening…" : "Open shift"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
