import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

// Table state (page, page size, sort, search, filters) lives in the URL query string, so a filtered
// view survives reload, can be bookmarked, and the back button works. (Laravel: like ?page=2&sort=name.)

export interface TableState {
  page: number;
  pageSize: number;
  sort: string;
  q: string;
  filters: Record<string, string>;
}

export function useTableState(defaultSort: string, filterKeys: string[] = []) {
  const [params, setParams] = useSearchParams();

  const state = useMemo<TableState>(() => {
    const filters: Record<string, string> = {};
    for (const k of filterKeys) {
      const v = params.get(k);
      if (v) filters[k] = v;
    }
    return {
      page: Math.max(1, Number(params.get("page")) || 1),
      pageSize: [10, 25, 50, 100].includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 25,
      sort: params.get("sort") || defaultSort,
      q: params.get("q") ?? "",
      filters,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, defaultSort, filterKeys.join(",")]);

  /** Change any of the values. Anything except `page` itself sends you back to page 1. */
  const update = useCallback(
    (patch: Partial<Omit<TableState, "filters">> & { filters?: Record<string, string | undefined> }) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const set = (k: string, v: string | number | undefined) => (v === undefined || v === "" ? next.delete(k) : next.set(k, String(v)));
          if (patch.page !== undefined) set("page", patch.page === 1 ? undefined : patch.page);
          else if (patch.q !== undefined || patch.sort !== undefined || patch.pageSize !== undefined || patch.filters) next.delete("page");
          if (patch.pageSize !== undefined) set("pageSize", patch.pageSize === 25 ? undefined : patch.pageSize);
          if (patch.sort !== undefined) set("sort", patch.sort === defaultSort ? undefined : patch.sort);
          if (patch.q !== undefined) set("q", patch.q);
          for (const [k, v] of Object.entries(patch.filters ?? {})) set(k, v);
          return next;
        },
        { replace: true },
      );
    },
    [setParams, defaultSort],
  );

  return { state, update };
}
