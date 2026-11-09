import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MenuItem } from "../lib/types";

export interface CartLine {
  menuItemId: number;
  name: string;
  priceCents: number; // display only: the server recalculates prices from the database
  quantity: number;
}

interface CartState {
  lines: CartLine[];
  count: number;
  totalCents: number;
  add: (item: MenuItem) => void;
  setQuantity: (menuItemId: number, quantity: number) => void;
  remove: (menuItemId: number) => void;
  clear: () => void;
}

const KEY = "ember_cart";
const MAX_QTY = 50; // same limit the API enforces

function load(): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (l): l is CartLine =>
        l && Number.isInteger(l.menuItemId) && typeof l.name === "string" && Number.isInteger(l.priceCents) && Number.isInteger(l.quantity) && l.quantity > 0,
    );
  } catch {
    return [];
  }
}

const CartContext = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(load);

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
    } catch {
      /* ignore */
    }
  }, [lines]);

  const add = useCallback((item: MenuItem) => {
    setLines((prev) => {
      const found = prev.find((l) => l.menuItemId === item.id);
      if (found) {
        return prev.map((l) =>
          l.menuItemId === item.id ? { ...l, priceCents: item.priceCents, quantity: Math.min(MAX_QTY, l.quantity + 1) } : l,
        );
      }
      return [...prev, { menuItemId: item.id, name: item.name, priceCents: item.priceCents, quantity: 1 }];
    });
  }, []);

  const setQuantity = useCallback((menuItemId: number, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.menuItemId !== menuItemId)
        : prev.map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l)),
    );
  }, []);

  const remove = useCallback((id: number) => setLines((prev) => prev.filter((l) => l.menuItemId !== id)), []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartState>(
    () => ({
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      totalCents: lines.reduce((n, l) => n + l.quantity * l.priceCents, 0),
      add,
      setQuantity,
      remove,
      clear,
    }),
    [lines, add, setQuantity, remove, clear],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
