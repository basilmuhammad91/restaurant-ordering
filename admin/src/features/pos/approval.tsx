import { ShieldCheck } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api, errorMessage } from "@/lib/api";

// MANAGER APPROVAL AT THE TILL. When a cashier tries something above their own limit (a big discount, a void,
// a refund) the API answers APPROVAL_REQUIRED and says exactly what must be approved. This hook shows a
// small dialog where a manager types their email and POS PIN; if it is accepted the blocked action is
// retried with the approval id. Nothing here decides who may approve: the API does (and counts PIN failures).

export interface ApprovalNeeded {
  type: string;
  reason?: string;
  amountMinor: number | null;
  currencyCode: string | null;
  payloadHash: string;
  entityType: string;
  entityId: string | null;
  locationId: string | null;
  percent: number | null;
}

interface Pending {
  needed: ApprovalNeeded;
  resolve: (approvalId: string | null) => void;
}

const LABELS: Record<string, string> = { DISCOUNT: "this discount", VOID: "this void", REFUND: "this refund", CASH_OUT: "this cash movement" };

/**
 * const { guard, dialog } = useApproval();
 * await guard((approvalId) => api.post(path, { ...body, approvalId }));   // retried with the approval if one is needed
 * ...render {dialog} once in the page.
 */
export function useApproval() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closing = useRef(false);

  const ask = useCallback(
    (needed: ApprovalNeeded) =>
      new Promise<string | null>((resolve) => {
        setPin("");
        setError(null);
        setPending({ needed, resolve });
      }),
    [],
  );

  const guard = useCallback(
    async <T,>(action: (approvalId?: string) => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== "APPROVAL_REQUIRED") throw e;
        const approvalId = await ask(e.details as unknown as ApprovalNeeded);
        if (!approvalId) throw new ApiError(403, "APPROVAL_DECLINED", "Approval was cancelled");
        return action(approvalId);
      }
    },
    [ask],
  );

  const close = (approvalId: string | null) => {
    if (closing.current) return;
    closing.current = true;
    pending?.resolve(approvalId);
    setPending(null);
    setBusy(false);
    queueMicrotask(() => { closing.current = false; });
  };

  const submit = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const n = pending.needed;
    try {
      const res = await api.post<{ data: { approvalId: string } }>("/approvals/override", {
        type: n.type, approverEmail: email.trim(), pin, locationId: n.locationId, entityType: n.entityType, entityId: n.entityId, payloadHash: n.payloadHash,
        amountMinor: n.amountMinor, percent: n.percent, currencyCode: n.currencyCode, reason: note.trim() || `Approved at the till (${n.type.toLowerCase()})`,
      });
      setPin("");
      close(res.data.approvalId);
    } catch (e) {
      setBusy(false);
      setPin("");
      setError(e instanceof ApiError && e.status === 429 ? "Too many attempts. Wait a minute and try again." : errorMessage(e));
    }
  };

  const dialog: ReactNode = (
    <Dialog open={!!pending} onOpenChange={(o) => !o && close(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /> Manager approval needed</DialogTitle>
          <DialogDescription>
            {pending?.needed.reason ?? "This is above your limit."} A manager must approve {LABELS[pending?.needed.type ?? ""] ?? "this"}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3" autoComplete="off">
          {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">{error}</div>}
          <div className="space-y-1.5"><Label htmlFor="appr-email">Manager email</Label><Input id="appr-email" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="appr-pin">Manager POS PIN</Label><Input id="appr-pin" type="password" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></div>
          <div className="space-y-1.5"><Label htmlFor="appr-note">Note (optional)</Label><Input id="appr-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why was this approved?" /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(null)}>Cancel</Button>
            <Button type="submit" disabled={busy || !email || pin.length < 4}>{busy ? "Checking…" : "Approve"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { guard, dialog };
}
