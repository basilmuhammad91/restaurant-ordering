import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/page/PageHeader";
import { ErrorState } from "@/components/page/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { formatMinor, useCurrencies } from "@/lib/money";
import { useScope } from "@/lib/scope";

// What every report screen shares: the period and branches from the top bar, ONE currency at a time, and CSV export.

const KEY = "restoflux_report_currency";

export function useReportCurrency() {
  const me = useMe();
  const { availableLocations } = useScope();
  const codes = [...new Set(availableLocations.map((l) => l.currencyCode))].sort();
  const [picked, setPicked] = useState<string | null>(() => { try { return localStorage.getItem(KEY); } catch { return null; } });
  const code = codes.includes(picked ?? "") ? picked! : codes.includes(me.tenant.baseCurrency) ? me.tenant.baseCurrency : codes[0] ?? me.tenant.baseCurrency;
  const choose = (c: string) => { setPicked(c); try { localStorage.setItem(KEY, c); } catch { /* ignore */ } };
  return { code, codes, choose, base: me.tenant.baseCurrency };
}

/** Params every period report takes. */
export function useReportParams(currencyCode: string) {
  const { brandId, effectiveLocationIds, availableLocations, range } = useScope();
  const all = effectiveLocationIds.length === availableLocations.length;
  return { from: range.from, to: range.to, currencyCode, ...(brandId ? { brandId } : {}), ...(!all && effectiveLocationIds.length ? { locationIds: effectiveLocationIds } : {}) };
}

export function useReport<T>(path: string, currencyCode: string, extra: Record<string, string | number | boolean | undefined> = {}, enabled = true) {
  const params = useReportParams(currencyCode);
  return useQuery({ queryKey: [path, "report", params, extra], enabled, queryFn: () => api.get<{ data: T; meta?: any }>(path, { ...params, ...extra }) });
}

export function useReportMoney(code: string) {
  const { exponent } = useCurrencies();
  const exp = exponent(code);
  return { money: (minor: number | null | undefined) => (minor === null || minor === undefined ? "-" : formatMinor(Math.round(minor), code, exp)), exp };
}

export function CurrencyTabs({ codes, active, onChange, base }: { codes: string[]; active: string; onChange: (c: string) => void; base: string }) {
  if (codes.length < 2) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Currency">
      <span className="text-sm text-muted-foreground">Currency:</span>
      {codes.map((c) => <button key={c} type="button" role="tab" aria-selected={c === active} onClick={() => onChange(c)} className={`rounded-full border px-3 py-1 text-sm ${c === active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{c}{c === base ? " (default)" : ""}</button>)}
      <span className="text-xs text-muted-foreground">A report never mixes currencies.</span>
    </div>
  );
}

/** Saves rows as a CSV file the browser downloads (opens in Excel). */
export function downloadCsv(name: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => { const s = v === null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(["﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export function ExportButton({ name, header, rows, disabled }: { name: string; header: string[]; rows: (string | number | null)[][]; disabled?: boolean }) {
  return <Button variant="outline" size="sm" disabled={disabled || rows.length === 0} onClick={() => downloadCsv(name, header, rows)}><Download /> Export CSV</Button>;
}

/** Page frame: title, the currency choice, then loading / error / content. */
export function ReportPage({ title, description, currency, state, actions, children }: {
  title: string; description: string; currency: ReturnType<typeof useReportCurrency>; actions?: ReactNode;
  state: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; children: ReactNode;
}) {
  const { range } = useScope();
  return (
    <>
      <PageHeader title={title} description={`${description} Period: ${range.from} to ${range.to} (the range in the top bar).`} actions={actions} />
      <CurrencyTabs codes={currency.codes} active={currency.code} onChange={currency.choose} base={currency.base} />
      {state.isError ? <ErrorState message={errorMessage(state.error)} onRetry={() => void state.refetch()} />
        : state.isPending ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        : children}
    </>
  );
}
