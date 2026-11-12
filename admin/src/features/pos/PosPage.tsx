import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Bike, Clock, ListOrdered, Minus, PauseCircle, Percent, Plus, Receipt as ReceiptIcon, Search, Send, ShoppingBag, Soup, Trash2, Utensils, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Logo } from "@/app/shell/Logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiError, api, errorMessage, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApproval } from "./approval";
import {
  addToCart, discountPercent, itemCount, linesFromOrder, money, newKey, previewOrder, setQuantity, toApiLines,
  type CartLine, type DiscountDraft, type MenuCombo, type MenuProduct, type SellableMenu,
} from "./cart";
import { ComboDialog, ItemDialog } from "./ItemDialogs";
import { PaymentDialog } from "./PaymentDialog";
import { ReceiptDialog } from "./Receipt";
import { DiscountDialog } from "./DiscountDialog";
import { OpenShiftDialog } from "./SmallDialogs";
import type { PosContext, PosOrder } from "./types";

// THE POINT OF SALE. Left: categories. Centre: the menu as photo cards (only what this branch can sell right
// now: priced, in a menu being served, not 86'd). Right: the basket with live totals, discount, and the
// actions: hold, send to the kitchen, pay. The server prices every order itself; the totals here use the same
// shared maths so they match. Orders are safe to retry (the basket has an id), and payments too.

type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY";
const ORDER_TYPES: { value: OrderType; label: string; icon: typeof Utensils }[] = [
  { value: "DINE_IN", label: "Dine-in", icon: Utensils }, { value: "TAKEAWAY", label: "Takeaway", icon: ShoppingBag }, { value: "DELIVERY", label: "Delivery", icon: Bike },
];
const TAGS = ["HALAL", "VEGETARIAN", "VEGAN", "SPICY", "GLUTEN_FREE"] as const;
const BRANCH_KEY = "restoflux_pos_branch";

function Photo({ url, name, className = "" }: { url: string | null; name: string; className?: string }) {
  if (url) return <img src={url} alt="" loading="lazy" className={`object-cover ${className}`} />;
  // No photo yet: a quiet neutral tile with the initials, so a half-filled menu still looks tidy.
  return (
    <div className={`grid place-items-center bg-muted text-xl font-semibold tracking-wide text-muted-foreground/60 ${className}`} aria-hidden>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

/** The add button on a card: small and quiet until you hover, so the menu reads as a price list, not a toy. */
const ADD_BADGE = "absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border transition group-hover:bg-primary group-hover:text-primary-foreground group-hover:ring-primary";
const CARD = "group overflow-hidden rounded-lg border bg-card text-left transition hover:border-primary/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function MenuSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading the menu">
      {[0, 1].map((s) => (
        <div key={s}>
          <Skeleton className="mb-3 h-5 w-32" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: s === 0 ? 3 : 4 }, (_, i) => (
              <div key={i} className="overflow-hidden rounded-lg border bg-card">
                <Skeleton className="aspect-[16/10] w-full rounded-none" />
                <div className="space-y-2 p-3"><div className="flex justify-between gap-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-14" /></div><Skeleton className="h-3 w-full" /></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CategorySkeleton() {
  return <div className="space-y-1 p-2" aria-hidden>{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>;
}

export default function PosPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const branches = (me?.locations ?? []).filter((l) => l.type === "BRANCH");
  const [locationId, setLocationId] = useState(() => {
    try { const saved = localStorage.getItem(BRANCH_KEY); if (saved && branches.some((b) => b.id === saved)) return saved; } catch { /* ignore */ }
    return branches[0]?.id ?? "";
  });
  useEffect(() => { try { if (locationId) localStorage.setItem(BRANCH_KEY, locationId); } catch { /* ignore */ } }, [locationId]);

  const ctx = useQuery({ queryKey: ["/pos/context", locationId], enabled: !!locationId, queryFn: async () => (await api.get<{ data: PosContext }>("/pos/context", { locationId })).data, staleTime: 30_000 });
  const menuQ = useQuery({ queryKey: ["/catalog/sellable", locationId, "POS"], enabled: !!locationId, queryFn: async () => (await api.get<{ data: SellableMenu }>("/catalog/sellable", { locationId, channel: "POS" })).data, refetchInterval: 60_000 });
  const zonesQ = useQuery({ queryKey: ["/delivery-zones", locationId], enabled: !!locationId, staleTime: 60_000, queryFn: async () => (await api.get<{ data: { id: string; name: string; feeMinor: number }[] }>("/delivery-zones", { locationId, isActive: true, pageSize: 100 })).data });
  const running = useQuery({ queryKey: ["/orders", "running", locationId], enabled: !!locationId && can("orders.view"), queryFn: async () => (await api.get<Paged<PosOrder>>("/orders", { locationId, active: "true", pageSize: 50, sort: "placedAt" })).data, refetchInterval: 15_000 });

  const menu = menuQ.data;
  const fmt = useMemo(() => ({ symbol: ctx.data?.currency.symbol ?? "", exponent: ctx.data?.currency.exponent ?? 2 }), [ctx.data]);

  // ---- the basket ----
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("TAKEAWAY");
  const [tableId, setTableId] = useState("");
  const [covers, setCovers] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [discount, setDiscount] = useState<DiscountDraft | null>(null);
  const [cartId, setCartId] = useState(() => crypto.randomUUID());
  /** The order as saved on the server, once the basket has been sent. A held bill (OPEN) can still be edited. */
  const [saved, setSaved] = useState<PosOrder | null>(null);
  const locked = !!saved && saved.status !== "OPEN";

  const { guard, dialog: approvalDialog } = useApproval();

  const resetCart = useCallback(() => {
    setLines([]); setOrderType("TAKEAWAY"); setTableId(""); setCovers(""); setCustomerName(""); setCustomerPhone(""); setNotes(""); setAddress(""); setDeliveryFee("");
    setDiscount(null); setSaved(null); setCartId(crypto.randomUUID());
  }, []);
  useEffect(() => { resetCart(); }, [locationId, resetCart]);

  const preview = useMemo(() => previewOrder(lines, menu, orderType, discount, Math.round(Number(deliveryFee || 0) * 10 ** fmt.exponent)), [lines, menu, orderType, discount, deliveryFee, fmt.exponent]);
  const shown = saved && locked ? { subtotal: saved.subtotalMinor, discount: saved.discountMinor, tax: saved.taxMinor, delivery: saved.deliveryFeeMinor, total: saved.totalMinor } : { subtotal: preview.subtotalMinor, discount: preview.discountMinor, tax: preview.taxMinor, delivery: preview.deliveryFeeMinor, total: preview.totalMinor };

  // ---- browsing the menu ----
  const [search, setSearch] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const matches = useCallback((p: MenuProduct) => (!search || p.name.toLowerCase().includes(search.toLowerCase())) && tags.every((t) => p.tags.includes(t)), [search, tags]);
  const categories = useMemo(() => (menu?.categories ?? []).map((c) => ({ ...c, products: c.products.filter(matches) })).filter((c) => c.products.length > 0), [menu, matches]);
  const combos = useMemo(() => (tags.length ? [] : (menu?.combos ?? []).filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))), [menu, search, tags]);
  const goTo = (id: string) => { setCategory(id); sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  // ---- dialogs ----
  const [picking, setPicking] = useState<{ product: MenuProduct } | { combo: MenuCombo } | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [paying, setPaying] = useState<PosOrder | null>(null);
  const [receipt, setReceipt] = useState<{ order: PosOrder; change: number } | null>(null);
  const [runningOpen, setRunningOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);

  const addProduct = (p: MenuProduct) => {
    const simple = p.variants.length === 1 && p.modifierGroups.length === 0;
    if (simple) setLines((l) => addToCart(l, { ...makeSimple(p) }));
    else setPicking({ product: p });
  };
  const addCombo = (c: MenuCombo) => setPicking({ combo: c });
  const noteAdded = (line: CartLine) => { setLines((l) => addToCart(l, line)); setPicking(null); };

  // ---- sending the basket to the server ----
  const body = (status: "OPEN" | "CONFIRMED") => ({
    ...(saved ? {} : { id: cartId }),
    locationId, orderType, channel: "POS", status, lines: toApiLines(lines),
    customerName: customerName.trim() || null, customerPhone: customerPhone.trim() || null, notes: notes.trim() || null,
    ...(orderType === "DINE_IN" && tableId ? { tableId, covers: covers ? Number(covers) : null } : {}),
    ...(orderType === "DELIVERY" ? { deliveryAddress: { line1: address.trim() }, deliveryFeeMinor: Math.round(Number(deliveryFee || 0) * 10 ** fmt.exponent) } : {}),
  });

  const submit = useMutation({
    mutationFn: async (status: "OPEN" | "CONFIRMED") =>
      guard(async (approvalId) => {
        const payload = { ...body(status), ...(discount?.offer ? { offer: discount.offer } : discount ? { discount: { type: discount.type, value: discount.value, reasonId: discount.reasonId, note: discount.note.trim() || null, ...(approvalId ? { approvalId } : {}) } } : {}) };
        const res = saved ? await api.put<{ data: PosOrder }>(`/orders/${saved.id}`, payload) : await api.post<{ data: PosOrder }>("/orders", payload);
        return res.data;
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/orders"] }),
    onError: (e) => {
      if (e instanceof ApiError && e.code === "APPROVAL_DECLINED") return;
      toast.error(errorMessage(e));
      if (e instanceof ApiError && e.status === 422) void menuQ.refetch(); // an item may have just sold out
    },
  });

  const hold = async () => {
    const order = await submit.mutateAsync("OPEN").catch(() => null);
    if (order) { toast.success(`Held as ${order.orderNumber}`); resetCart(); }
  };
  const send = async () => {
    const order = await submit.mutateAsync("CONFIRMED").catch(() => null);
    if (order) { toast.success(`${order.orderNumber} sent to the kitchen`); resetCart(); }
  };
  const pay = async () => {
    if (saved && locked) { setPaying(saved); return; }
    const order = await submit.mutateAsync("CONFIRMED").catch(() => null);
    if (order) { setSaved(order); setPaying(order); }
  };

  const openRunning = async (o: PosOrder) => {
    setRunningOpen(false);
    if (!menu) return;
    const full = (await api.get<{ data: PosOrder }>(`/orders/${o.id}`)).data;
    if (full.status === "OPEN") {
      const rebuilt = linesFromOrder(full.lines, menu);
      if (rebuilt.missing) toast.warning(`${rebuilt.missing} item(s) are no longer sold and were left out.`);
      setLines(rebuilt.lines); setOrderType(full.orderType as OrderType); setTableId(full.tableId ?? ""); setCovers(full.covers ? String(full.covers) : ""); setCustomerName(full.customerName ?? ""); setCustomerPhone(full.customerPhone ?? ""); setNotes(full.notes ?? "");
      setDiscount(null); setSaved(full);
    } else {
      setLines([]); setSaved(full); setOrderType(full.orderType as OrderType);
    }
  };

  const [cancelling, setCancelling] = useState(false);
  const cancelHeld = async () => {
    if (!saved) { resetCart(); return; }
    setCancelling(true);
    try {
      const reason = ctx.data?.reasons.void[0];
      if (!reason) throw new Error("No void reason is set up");
      await guard((approvalId) => api.post(`/orders/${saved.id}/status`, { status: "CANCELLED", reasonId: reason.id, ...(approvalId ? { approvalId } : {}) }));
      toast.success(`${saved.orderNumber} cancelled`);
      void qc.invalidateQueries({ queryKey: ["/orders"] });
      resetCart();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "APPROVAL_DECLINED")) toast.error(errorMessage(e));
    } finally {
      setCancelling(false);
    }
  };

  // ---- rendering ----
  if (!branches.length) {
    return <div className="grid min-h-screen place-items-center p-6 text-center"><div><Soup className="mx-auto mb-3 size-10 text-muted-foreground" /><h1 className="text-lg font-semibold">No branch to sell from</h1><p className="text-sm text-muted-foreground">You are not assigned to a branch. Ask an administrator to give you access.</p><Button asChild className="mt-4"><Link to="/">Back to dashboard</Link></Button></div></div>;
  }

  const activeCount = running.data?.length ?? 0;
  const shift = ctx.data?.shift;
  const canTakeCash = !!shift;
  const hasItems = lines.length > 0;
  const busy = submit.isPending || cancelling;
  const dPercent = discount ? discountPercent(discount, preview.subtotalMinor) : 0;
  const needsAddress = orderType === "DELIVERY" && !address.trim();
  const cartInvalid = !hasItems || needsAddress;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* top bar */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to dashboard"><Link to="/"><ArrowLeft /></Link></Button>
        <Logo size={26} wordmark={false} />
        <div className="w-52">
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="h-9" aria-label="Branch"><SelectValue /></SelectTrigger>
            <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="inline-flex rounded-lg border p-0.5" role="radiogroup" aria-label="Order type">
          {ORDER_TYPES.map((t) => (
            <button key={t.value} type="button" role="radio" aria-checked={orderType === t.value} disabled={locked} onClick={() => setOrderType(t.value)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${orderType === t.value ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </div>
        <div className="relative ml-1 min-w-40 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-9" placeholder="Search the menu…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the menu" />
        </div>
        <div className="flex flex-wrap items-center gap-1" aria-label="Dietary filters">
          {TAGS.map((t) => {
            const on = tags.includes(t);
            return <button key={t} type="button" aria-pressed={on} onClick={() => setTags((x) => (on ? x.filter((y) => y !== t) : [...x, t]))} className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{on ? "✓ " : "+ "}{t.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</button>;
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {shift ? (
            <Badge variant="secondary" className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"><Clock className="size-3" /> Shift open</Badge>
          ) : (
            <Button size="sm" variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400" onClick={() => setShiftOpen(true)} disabled={!can("shifts.open")} title={can("shifts.open") ? "Open a shift to take cash" : "Ask a manager to open a shift"}><Wallet /> No shift: open</Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setRunningOpen(true)}><ListOrdered /> Running orders {activeCount > 0 && <Badge className="ml-1">{activeCount}</Badge>}</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* categories */}
        <nav className="hidden w-52 shrink-0 overflow-y-auto border-r bg-card/50 py-2 md:block" aria-label="Categories">
          {menuQ.isPending || ctx.isPending ? <CategorySkeleton /> : (
            <>
              {combos.length > 0 && <button type="button" onClick={() => goTo("__combos")} className={`flex w-full items-center gap-2 border-l-2 px-4 py-2.5 text-left text-sm ${category === "__combos" ? "border-primary bg-accent font-medium" : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}><Percent className="size-4" /><span className="flex-1">Deals</span><span className="text-xs tabular-nums text-muted-foreground">{combos.length}</span></button>}
              {categories.map((c) => (
                <button key={c.id} type="button" onClick={() => goTo(c.id)} className={`flex w-full items-center gap-2 border-l-2 px-4 py-2.5 text-left text-sm ${category === c.id ? "border-primary bg-accent font-medium" : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}>
                  <span className="flex-1 truncate">{c.name}</span><span className="text-xs tabular-nums text-muted-foreground">{c.products.length}</span>
                </button>
              ))}
            </>
          )}
        </nav>

        {/* menu */}
        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {menuQ.isPending || ctx.isPending ? <MenuSkeleton /> : menuQ.isError ? (
            <div className="grid h-full place-items-center text-center"><div><p className="mb-2 text-destructive">{errorMessage(menuQ.error)}</p><Button onClick={() => void menuQ.refetch()}>Try again</Button></div></div>
          ) : categories.length === 0 && combos.length === 0 ? (
            <div className="grid h-full place-items-center text-center text-muted-foreground"><div><Soup className="mx-auto mb-2 size-8" /><p>{search || tags.length ? "Nothing matches your search." : "Nothing is on sale at this branch right now."}</p>{!search && !tags.length && <p className="text-sm">Check the menu, prices and the 86 board in the admin app.</p>}</div></div>
          ) : (
            <div className="space-y-8">
              {combos.length > 0 && (
                <section ref={(el) => { sectionRefs.current.__combos = el; }} aria-label="Deals">
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Deals</h2>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
                    {combos.map((c) => (
                      <button key={c.id} type="button" disabled={locked} onClick={() => addCombo(c)} className={CARD}>
                        <div className="relative"><Photo url={c.imageUrl} name={c.name} className="aspect-[16/10] w-full" /><span className={ADD_BADGE}><Plus className="size-4" /></span>
                          {c.compareAtMinor && c.compareAtMinor > c.priceMinor && <span className="absolute bottom-2 left-2 rounded bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">Save {money(c.compareAtMinor - c.priceMinor, fmt)}</span>}</div>
                        <div className="p-3"><div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{c.name}</span><span className="whitespace-nowrap text-sm font-semibold tabular-nums">{c.compareAtMinor && c.compareAtMinor > c.priceMinor && <s className="mr-1 text-xs font-normal text-muted-foreground">{money(c.compareAtMinor, fmt)}</s>}{money(c.priceMinor, fmt)}</span></div>
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{c.slots.map((s) => s.name).join(" + ")}</p></div>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {categories.map((c) => (
                <section key={c.id} ref={(el) => { sectionRefs.current[c.id] = el; }} aria-label={c.name}>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{c.name}</h2>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
                    {c.products.map((p) => {
                      const from = Math.min(...p.variants.map((v) => v.priceMinor));
                      const was = p.variants.length === 1 ? p.variants[0]!.compareAtMinor : null;
                      return (
                        <button key={p.id} type="button" disabled={locked} onClick={() => addProduct(p)} className={CARD} aria-label={`${p.name}, ${money(from, fmt)}`}>
                          <div className="relative"><Photo url={p.imageUrl} name={p.name} className="aspect-[16/10] w-full" /><span className={ADD_BADGE}><Plus className="size-4" /></span>
                            {p.tags.includes("SPICY") && <span className="absolute left-2 top-2 size-2.5 rounded-full bg-orange-500 ring-2 ring-white" title="Spicy" />}</div>
                          <div className="p-3"><div className="flex items-baseline justify-between gap-2"><span className="font-semibold leading-tight">{p.name}</span><span className="whitespace-nowrap text-sm font-semibold tabular-nums">{p.variants.length > 1 && <span className="mr-1 text-xs font-normal text-muted-foreground">from</span>}{was && was > from && <s className="mr-1 text-xs font-normal text-muted-foreground">{money(was, fmt)}</s>}{money(from, fmt)}</span></div>
                            {p.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}</div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </main>

        {/* basket */}
        <aside className="flex w-[22rem] shrink-0 flex-col border-l bg-card" aria-label="Basket">
          <div className="border-b p-3">
            <div className="flex items-center justify-between">
              <div><div className="font-semibold">{saved ? `Order ${saved.orderNumber}` : "New order"}</div><div className="text-xs text-muted-foreground">{saved ? (locked ? `${saved.status.toLowerCase().replace(/_/g, " ")} · ${saved.paymentStatus.toLowerCase().replace(/_/g, " ")}` : "Held bill") : `Items: ${itemCount(lines)}`}</div></div>
              {(hasItems || saved) && <Button variant="ghost" size="sm" onClick={saved && saved.status !== "OPEN" ? resetCart : () => (saved ? void cancelHeld() : resetCart())} disabled={busy}>{saved && saved.status !== "OPEN" ? <><X /> Close</> : <><Trash2 /> {saved ? "Cancel order" : "Clear"}</>}</Button>}
            </div>
            {!locked && (
              <div className="mt-2 space-y-1.5">
                <div className="grid grid-cols-2 gap-1.5"><Input className="h-8 text-sm" placeholder="Phone number…" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} aria-label="Customer phone" /><Input className="h-8 text-sm" placeholder="Customer name…" value={customerName} onChange={(e) => setCustomerName(e.target.value)} aria-label="Customer name" /></div>
                {orderType === "DINE_IN" && (
                  <div className="grid grid-cols-[1fr_5rem] gap-1.5">
                    <Select value={tableId || "__none__"} onValueChange={(v) => setTableId(v === "__none__" ? "" : v)}><SelectTrigger className="h-8 text-sm" aria-label="Table"><SelectValue placeholder="Table" /></SelectTrigger><SelectContent><SelectItem value="__none__">No table</SelectItem>{(ctx.data?.tables ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}{t.section ? ` · ${t.section}` : ""} ({t.seats})</SelectItem>)}</SelectContent></Select>
                    <Input className="h-8 text-sm" inputMode="numeric" placeholder="Covers" value={covers} onChange={(e) => setCovers(e.target.value.replace(/\D/g, ""))} aria-label="Covers" />
                  </div>
                )}
                {orderType === "DELIVERY" && (zonesQ.data ?? []).length > 0 && <div className="flex flex-wrap gap-1.5" role="group" aria-label="Delivery zones">{zonesQ.data!.map((z) => <button key={z.id} type="button" onClick={() => setDeliveryFee(String(z.feeMinor / 10 ** fmt.exponent))} className="rounded-full border px-2 py-0.5 text-xs hover:bg-accent">{z.name} · {money(z.feeMinor, fmt)}</button>)}</div>}
                {orderType === "DELIVERY" && <div className="grid grid-cols-[1fr_5.5rem] gap-1.5"><Input className="h-8 text-sm" placeholder="Delivery address…" value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Delivery address" /><Input className="h-8 text-sm" inputMode="decimal" placeholder="Fee" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} aria-label="Delivery fee" /></div>}
                <Input className="h-8 text-sm" placeholder="Order instructions…" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Order instructions" />
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {locked && saved ? (
              <ul className="divide-y">{saved.lines.filter((l) => l.status !== "VOIDED").map((l) => (
                <li key={l.id} className="px-3 py-2 text-sm"><div className="flex justify-between gap-2"><span>{l.quantity} × {l.nameSnapshot}{l.variantNameSnapshot ? ` (${l.variantNameSnapshot})` : ""}</span><span className="tabular-nums">{money(l.lineSubtotalMinor, fmt)}</span></div>
                  {l.modifiers.length > 0 && <div className="text-xs text-muted-foreground">{l.modifiers.map((m) => m.nameSnapshot).join(", ")}</div>}</li>
              ))}</ul>
            ) : !hasItems ? (
              <div className="grid h-full place-items-center p-6 text-center text-muted-foreground"><div><ShoppingBag className="mx-auto mb-2 size-9" /><div className="text-lg font-medium">Cart is empty</div><div className="text-sm">Tap an item to add it.</div></div></div>
            ) : (
              <ul className="divide-y">{lines.map((l) => (
                <li key={l.key} className="px-3 py-2">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-medium leading-tight">{l.name}{l.variantName ? <span className="text-muted-foreground"> ({l.variantName})</span> : null}</div>
                    {l.modifiers.length > 0 && <div className="text-xs text-muted-foreground">{l.modifiers.map((m) => m.name).join(", ")}</div>}
                    {l.choices.length > 0 && <div className="text-xs text-muted-foreground">{l.choices.map((c) => c.name).join(", ")}</div>}
                    {l.notes && <div className="text-xs italic text-muted-foreground">“{l.notes}”</div>}</div>
                    <span className="whitespace-nowrap text-sm font-semibold tabular-nums">{money(l.unitMinor * l.quantity, fmt)}</span></div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <div className="inline-flex items-center gap-1.5"><Button size="icon" variant="outline" className="size-7" aria-label={`Less ${l.name}`} onClick={() => setLines((x) => setQuantity(x, l.key, l.quantity - 1))}><Minus /></Button><span className="w-6 text-center text-sm font-semibold tabular-nums">{l.quantity}</span><Button size="icon" variant="outline" className="size-7" aria-label={`More ${l.name}`} onClick={() => setLines((x) => setQuantity(x, l.key, l.quantity + 1))}><Plus /></Button></div>
                    <Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-destructive" aria-label={`Remove ${l.name}`} onClick={() => setLines((x) => setQuantity(x, l.key, 0))}><Trash2 /></Button>
                  </div>
                </li>
              ))}</ul>
            )}
          </div>

          <div className="space-y-1 border-t p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{money(shown.subtotal, fmt)}</span></div>
            {shown.discount > 0 && <div className="flex justify-between text-emerald-700 dark:text-emerald-400"><span>Discount{discount ? ` (${discount.type === "PERCENT" ? `${discount.value}%` : "amount"})` : ""}</span><span className="tabular-nums">-{money(shown.discount, fmt)}</span></div>}
            {shown.delivery > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Delivery</span><span className="tabular-nums">{money(shown.delivery, fmt)}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Tax{(saved && locked ? saved.pricesIncludeTax : menu?.tax?.pricesIncludeTax) ? " (included)" : ""}</span><span className="tabular-nums">{money(shown.tax, fmt)}</span></div>
            <div className="flex items-baseline justify-between pt-1 text-lg font-bold"><span>Total</span><span className="tabular-nums" aria-live="polite">{money(shown.total, fmt)}</span></div>
            {saved && locked && saved.paidMinor > 0 && <div className="flex justify-between text-muted-foreground"><span>Paid</span><span className="tabular-nums">{money(saved.paidMinor, fmt)}</span></div>}
            {saved && locked && saved.totalMinor - saved.paidMinor > 0 && <div className="flex justify-between font-semibold"><span>Due</span><span className="tabular-nums">{money(saved.totalMinor - saved.paidMinor, fmt)}</span></div>}
          </div>

          <div className="space-y-2 border-t p-3">
            {!locked && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" disabled={!hasItems || busy} onClick={() => setDiscountOpen(true)}><Percent /> {discount ? (discount.label ?? `Discount ${discount.type === "PERCENT" ? `${discount.value}%` : ""}${dPercent > 0 && discount?.type === "AMOUNT" ? `${dPercent.toFixed(0)}%` : ""}`) : "Discount"}</Button>
                <Button variant="outline" disabled={cartInvalid || busy} onClick={() => void hold()}><PauseCircle /> Hold</Button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {!locked && <Button variant="secondary" size="lg" disabled={cartInvalid || busy || !can("orders.create")} onClick={() => void send()}><Send /> Send</Button>}
              <Button size="lg" className={locked ? "col-span-2" : ""} disabled={(locked ? saved!.totalMinor - saved!.paidMinor <= 0 : cartInvalid) || busy || !can("payments.take")} onClick={() => void pay()}>
                <Wallet /> {locked ? (saved!.totalMinor - saved!.paidMinor > 0 ? `Pay ${money(saved!.totalMinor - saved!.paidMinor, fmt)}` : "Paid") : `Pay ${money(shown.total, fmt)}`}
              </Button>
              {locked && saved && <Button variant="outline" className="col-span-2" onClick={() => setReceipt({ order: saved, change: 0 })}><ReceiptIcon /> Receipt</Button>}
            </div>
            {!canTakeCash && hasItems && <p className="text-center text-xs text-amber-700 dark:text-amber-400">No shift is open: card payments work, cash needs a shift.</p>}
          </div>
        </aside>
      </div>

      {picking && "product" in picking && <ItemDialog product={picking.product} fmt={fmt} onAdd={noteAdded} onClose={() => setPicking(null)} />}
      {picking && "combo" in picking && <ComboDialog combo={picking.combo} fmt={fmt} onAdd={noteAdded} onClose={() => setPicking(null)} />}
      {discountOpen && ctx.data && <DiscountDialog locationId={locationId} canManual={can("orders.discount")} reasons={ctx.data.reasons.discount} subtotalMinor={preview.subtotalMinor} fmt={fmt} current={discount} onApply={(d) => { setDiscount(d); setDiscountOpen(false); }} onClear={() => { setDiscount(null); setDiscountOpen(false); }} onClose={() => setDiscountOpen(false)} />}
      {paying && ctx.data && (
        <PaymentDialog order={paying} methods={ctx.data.paymentMethods.filter((m) => m.type !== "CASH" || canTakeCash)} fmt={fmt} onClose={() => { setPaying(null); void qc.invalidateQueries({ queryKey: ["/orders"] }); }}
          onUpdated={(o) => setSaved(o)} onDone={(o, change) => { setPaying(null); setReceipt({ order: o, change }); void qc.invalidateQueries({ queryKey: ["/orders"] }); resetCart(); }} />
      )}
      {receipt && <ReceiptDialog order={receipt.order} fmt={fmt} title={receipt.order.paymentStatus === "PAID" ? "Paid: receipt" : "Receipt"} onClose={() => setReceipt(null)} />}
      {shiftOpen && <OpenShiftDialog locationId={locationId} fmt={fmt} onOpened={() => { setShiftOpen(false); void ctx.refetch(); }} onClose={() => setShiftOpen(false)} />}

      {runningOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setRunningOpen(false)} role="dialog" aria-modal="true" aria-label="Running orders">
          <div className="flex h-full w-full max-w-md flex-col bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-3"><h2 className="font-semibold">Running orders</h2><Button variant="ghost" size="icon" aria-label="Close" onClick={() => setRunningOpen(false)}><X /></Button></div>
            <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
              {(running.data ?? []).length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No orders in progress.</li>}
              {(running.data ?? []).map((o) => (
                <li key={o.id}><button type="button" onClick={() => void openRunning(o)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-accent/50">
                  <div><div className="font-medium">{o.orderNumber} <span className="text-xs font-normal text-muted-foreground">{o.orderType.replace("_", " ").toLowerCase()}</span></div>
                    <div className="text-xs text-muted-foreground">{o.status === "OPEN" ? "Held" : o.status.toLowerCase().replace(/_/g, " ")}{o.customerName ? ` · ${o.customerName}` : ""} · {o.lines.filter((l) => l.kind !== "COMBO_ITEM" && l.status !== "VOIDED").reduce((a, l) => a + l.quantity, 0)} items</div></div>
                  <div className="text-right"><div className="font-semibold tabular-nums">{money(o.totalMinor, fmt)}</div><div className={`text-xs ${o.totalMinor - o.paidMinor > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>{o.totalMinor - o.paidMinor > 0 ? `due ${money(o.totalMinor - o.paidMinor, fmt)}` : "paid"}</div></div>
                </button></li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {approvalDialog}
    </div>
  );
}

/** A product with one size and nothing to choose goes straight into the basket. */
function makeSimple(p: MenuProduct): CartLine {
  const v = p.variants[0]!;
  return { key: newKey(), kind: "item", variantId: v.id, name: p.name, variantName: null, imageUrl: p.imageUrl, quantity: 1, unitMinor: v.priceMinor, modifiers: [], choices: [], notes: "", taxCategoryId: p.taxCategoryId };
}

