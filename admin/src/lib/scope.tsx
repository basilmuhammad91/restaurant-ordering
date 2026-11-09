import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMe } from "./auth";
import { rangeForPreset, type DateRange, type RangePreset } from "./scope-range";

// The global "what am I looking at" selection shown in the top bar: which brand / branches, and which
// date range. Pages and reports read it with useScope() and send it to the API as ordinary query
// parameters (the API still intersects it with the user's allowed branches, so it is never trusted).

interface StoredScope {
  brandId: string | null;
  locationIds: string[];
  range: DateRange;
}

const KEY = "restoflux_scope_v1";
export { rangeForPreset, type DateRange, type RangePreset };

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today", yesterday: "Yesterday", last7: "Last 7 days", last30: "Last 30 days", thisMonth: "This month", custom: "Custom range",
};

function load(): StoredScope {
  const fallback: StoredScope = { brandId: null, locationIds: [], range: rangeForPreset("last30") };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as StoredScope | null;
    if (!raw) return fallback;
    // a stored preset range is recomputed so "Today" is always today
    const range = raw.range.preset === "custom" ? raw.range : rangeForPreset(raw.range.preset);
    return { brandId: raw.brandId ?? null, locationIds: Array.isArray(raw.locationIds) ? raw.locationIds : [], range };
  } catch {
    return fallback;
  }
}

interface ScopeValue {
  brandId: string | null;
  /** Explicitly selected branches (empty = all the user may see). */
  locationIds: string[];
  range: DateRange;
  /** Branches that match the brand filter, from the user's allowed set. */
  availableLocations: { id: string; code: string; name: string; type: string; brandId: string | null; currencyCode: string; timezone: string }[];
  /** The branch ids to send to the API (selection, or everything available when nothing is selected). */
  effectiveLocationIds: string[];
  setBrand: (id: string | null) => void;
  setLocations: (ids: string[]) => void;
  setRange: (range: DateRange) => void;
}

const ScopeContext = createContext<ScopeValue | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const [stored, setStored] = useState<StoredScope>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(stored));
    } catch {
      /* ignore */
    }
  }, [stored]);

  const availableLocations = useMemo(
    () => me.locations.filter((l) => !stored.brandId || l.brandId === stored.brandId || l.brandId === null),
    [me.locations, stored.brandId],
  );

  // Drop selections that are no longer available (brand changed, access revoked).
  const locationIds = useMemo(() => stored.locationIds.filter((id) => availableLocations.some((l) => l.id === id)), [stored.locationIds, availableLocations]);
  const effectiveLocationIds = useMemo(() => (locationIds.length ? locationIds : availableLocations.map((l) => l.id)), [locationIds, availableLocations]);

  const setBrand = useCallback((brandId: string | null) => setStored((s) => ({ ...s, brandId, locationIds: [] })), []);
  const setLocations = useCallback((ids: string[]) => setStored((s) => ({ ...s, locationIds: ids })), []);
  const setRange = useCallback((range: DateRange) => setStored((s) => ({ ...s, range })), []);

  const value = useMemo<ScopeValue>(
    () => ({ brandId: stored.brandId, locationIds, range: stored.range, availableLocations, effectiveLocationIds, setBrand, setLocations, setRange }),
    [stored.brandId, stored.range, locationIds, availableLocations, effectiveLocationIds, setBrand, setLocations, setRange],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeValue {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used inside <ScopeProvider>");
  return ctx;
}
