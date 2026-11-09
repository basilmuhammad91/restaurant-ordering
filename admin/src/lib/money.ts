import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

// Money is always an integer in MINOR units (paisa, fils, cents) plus a currency. How many decimal
// places a currency has comes from the API (PKR/AED/USD = 2, KWD = 3, JPY = 0), never hard-coded.

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  minorUnitExponent: number;
}

export function useCurrencies() {
  const q = useQuery({ queryKey: ["/currencies"], queryFn: async () => (await api.get<{ data: Currency[] }>("/currencies")).data, staleTime: 3_600_000 });
  const exponent = (code: string) => q.data?.find((c) => c.code === code)?.minorUnitExponent ?? 2;
  return { currencies: q.data ?? [], exponent, isLoading: q.isLoading };
}

export function formatMinor(minor: number, currency: string, exponent = 2): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(minor / 10 ** exponent);
  } catch {
    return `${currency} ${(minor / 10 ** exponent).toFixed(exponent)}`;
  }
}

/** "1250.50" -> 125050 (exponent 2) using string maths, never floating point. Returns null if not a valid amount. */
export function toMinor(input: string, exponent: number): number | null {
  const s = input.trim().replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(exponent, "0");
  if (frac.length > exponent && /[1-9]/.test(frac.slice(exponent))) return null; // more decimals than the currency allows
  const minor = Number(m[1]) * 10 ** exponent + Number(frac.slice(0, exponent) || 0);
  return Number.isSafeInteger(minor) && minor <= 2_000_000_000 ? minor : null;
}

export const fromMinor = (minor: number, exponent: number): string => (minor / 10 ** exponent).toFixed(exponent);
