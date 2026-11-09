import type { PlatformMe } from "@restoflux/contracts";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TableState } from "@/components/data-table/useTableState";
import { platformApi, platformClient, type Paged } from "./api";

// Sign-in state for the Restoflux team's console. It mirrors lib/auth.tsx but is completely separate:
// its own token, its own cookie and its own provider, mounted only around the /platform routes.

type Status = "loading" | "anonymous" | "authenticated";
interface PlatformAuthValue {
  status: Status;
  me: PlatformMe | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<PlatformAuthValue | null>(null);

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: Status; me: PlatformMe | null }>({ status: "loading", me: null });
  const qc = useQueryClient();

  useEffect(() => {
    let alive = true;
    (async () => {
      if (await platformClient.refreshSession()) {
        try {
          const me = await platformClient.fetchMe();
          if (alive) setState({ status: "authenticated", me });
          return;
        } catch {
          /* fall through */
        }
      }
      if (alive) setState({ status: "anonymous", me: null });
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    platformClient.setSessionLostHandler(() => {
      platformClient.setAccessToken(null);
      qc.clear();
      setState({ status: "anonymous", me: null });
    });
    return () => platformClient.setSessionLostHandler(null);
  }, [qc]);

  const login = useCallback(async (email: string, password: string) => {
    setState({ status: "authenticated", me: await platformClient.login(email, password) });
  }, []);
  const logout = useCallback(async () => {
    await platformClient.logout().catch(() => undefined);
    qc.clear();
    setState({ status: "anonymous", me: null });
  }, [qc]);

  const value = useMemo(() => ({ ...state, login, logout }), [state, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlatformAuth(): PlatformAuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlatformAuth must be used inside <PlatformAuthProvider>");
  return v;
}

// ---- data helpers (query keys start with "/platform/..." so invalidation works like the staff ones) ----
type Params = Record<string, string | number | boolean | undefined | null | string[]>;

export function usePlatformList<T>(path: string, state: TableState, extra: Params = {}) {
  return useQuery({
    queryKey: [`/platform${path}`, "list", state, extra],
    queryFn: () => platformApi.get<Paged<T>>(path, { page: state.page, pageSize: state.pageSize, sort: state.sort, q: state.q, ...state.filters, ...extra }),
    placeholderData: keepPreviousData,
  });
}

export function usePlatformInvalidate() {
  const qc = useQueryClient();
  return (...paths: string[]) => Promise.all(paths.map((p) => qc.invalidateQueries({ queryKey: [`/platform${p}`] })));
}
