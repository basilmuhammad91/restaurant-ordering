import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/api";

// Tiny data-fetching hook (a stand-in for React Query, to keep dependencies minimal).
// Re-runs when `deps` change, ignores out-of-order responses, optional polling.
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[], opts: { intervalMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const latest = useRef(0);

  const load = useCallback(async (silent = false) => {
    const id = ++latest.current;
    if (!silent) setLoading(true);
    try {
      const result = await fnRef.current();
      if (id !== latest.current) return; // a newer request superseded this one
      setData(result);
      setError(null);
    } catch (e) {
      if (id !== latest.current) return;
      setError(errorMessage(e));
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!opts.intervalMs) return;
    const t = setInterval(() => void load(true), opts.intervalMs); // silent: no spinner flicker
    return () => clearInterval(t);
  }, [opts.intervalMs, load]);

  return { data, error, loading, reload: () => load(), setData };
}
