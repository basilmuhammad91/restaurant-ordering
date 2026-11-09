import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Deal, MenuItem } from "../lib/types";

// A cart line is either a menu item or a deal. `key` is unique across both ("item-3", "deal-1").
export interface CartLine {
  key: string;
  kind: "item" | "deal";
  id: number; // menuItemId or dealId
  name: string;
  priceCents: number; // display only: the server recalculates prices from the database
  quantity: number;
}

interface CartState {
  lines: CartLine[];
  count: number;
  totalCents: number;
  quantityOf: (kind: CartLine["kind"], id: number) => number;
  addItem: (item: MenuItem) => void;
  addDeal: (deal: Deal) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
}

const STORAGE_KEY = "restoflux_cart_v2"; // v2: lines can be deals
const MAX_QTY = { item: 50, deal: 20 } as const; // same limits the API enforces

function load(): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (l): l is CartLine =>
        l && (l.kind === "item" || l.kind === "deal") && typeof l.key === "string" && Number.isInteger(l.id) &&
        typeof l.name === "string" && Number.isInteger(l.priceCents) && Number.isInteger(l.quantity) && l.quantity > 0,
    );
  } catch {
    return [];
  }
}

const CartContext = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* ignore */
    }
  }, [lines]);

  const addLine = useCallback((kind: CartLine["kind"], id: number, name: string, priceCents: number) => {
    const key = `${kind}-${id}`;
    setLines((prev) =>
      prev.some((l) => l.key === key)
        ? prev.map((l) => (l.key === key ? { ...l, priceCents, quantity: Math.min(MAX_QTY[kind], l.quantity + 1) } : l))
        : [...prev, { key, kind, id, name, priceCents, quantity: 1 }],
    );
  }, []);

  const addItem = useCallback((m: MenuItem) => addLine("item", m.id, m.name, m.priceCents), [addLine]);
  const addDeal = useCallback((d: Deal) => addLine("deal", d.id, d.name, d.dealPriceCents), [addLine]);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.key !== key)
        : prev.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY[l.kind], quantity) } : l)),
    );
  }, []);
  const remove = useCallback((key: string) => setLines((prev) => prev.filter((l) => l.key !== key)), []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartState>(
    () => ({
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      totalCents: lines.reduce((n, l) => n + l.quantity * l.priceCents, 0),
      quantityOf: (kind, id) => lines.find((l) => l.key === `${kind}-${id}`)?.quantity ?? 0,
      addItem,
      addDeal,
      setQuantity,
      remove,
      clear,
    }),
    [lines, addItem, addDeal, setQuantity, remove, clear],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
