import { QueryClient, keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TableState } from "@/components/data-table/useTableState";
import { ApiError, api, type Paged } from "./api";

// Server-state helpers (TanStack Query). Query keys start with the API path, so after a change we can
// invalidate everything that came from that resource in one call.

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // retry once for network/server hiccups, never for 4xx (a 403/404/422 will not fix itself)
      retry: (count, error) => !(error instanceof ApiError && error.status < 500 && error.status !== 0) && count < 1,
    },
  },
});

type Params = Record<string, string | number | boolean | undefined | null | string[]>;

/** One page of a list endpoint, driven by the URL table state. Keeps the old rows on screen while the next page loads. */
export function useList<T>(path: string, state: TableState, extra: Params = {}, enabled = true) {
  return useQuery({
    queryKey: [path, "list", state, extra],
    queryFn: () => api.get<Paged<T>>(path, { page: state.page, pageSize: state.pageSize, sort: state.sort, q: state.q, ...state.filters, ...extra }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Every row of a (small) list, for dropdowns: brands, currencies, roles ... */
export function useAll<T>(path: string, params: Params = {}, enabled = true) {
  return useQuery({
    queryKey: [path, "all", params],
    queryFn: async () => (await api.get<Paged<T>>(path, { pageSize: 100, ...params })).data,
    staleTime: 60_000,
    enabled,
  });
}

/** Refetch every cached list/detail that came from `path` (or several paths). */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...paths: string[]) => Promise.all(paths.map((p) => qc.invalidateQueries({ queryKey: [p] })));
}
