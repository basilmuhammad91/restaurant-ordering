import { useQueryClient } from "@tanstack/react-query";
import type { MeResponse, PermissionKey } from "@restoflux/contracts";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchMe, login as apiLogin, logoutRequest, refreshSession, setAccessToken, setSessionLostHandler } from "./api";
import { canAny, toPermissionSet } from "./permissions";

// Who is logged in. On startup there is no token in memory, so we try to exchange the httpOnly refresh
// cookie for one (a page reload keeps you logged in without ever storing a token in localStorage).

type Status = "loading" | "anonymous" | "authenticated";

interface AuthValue {
  status: Status;
  me: MeResponse | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-read /auth/me (after the user's own roles/branches may have changed). */
  refreshMe: () => Promise<void>;
  can: (permission: PermissionKey) => boolean;
  canAny: (permissions: readonly PermissionKey[]) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: Status; me: MeResponse | null }>({ status: "loading", me: null });
  const queryClient = useQueryClient();
  const permissions = useMemo(() => toPermissionSet(state.me), [state.me]);

  // Restore the session on first load.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (await refreshSession()) {
        try {
          const me = await fetchMe();
          if (alive) setState({ status: "authenticated", me });
          return;
        } catch {
          /* fall through to anonymous */
        }
      }
      if (alive) setState({ status: "anonymous", me: null });
    })();
    return () => {
      alive = false;
    };
  }, []);

  // If a request cannot be authenticated even after a refresh, drop to the login screen.
  useEffect(() => {
    setSessionLostHandler(() => {
      setAccessToken(null);
      queryClient.clear();
      setState({ status: "anonymous", me: null });
    });
    return () => setSessionLostHandler(null);
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    const me = await apiLogin(email, password);
    setState({ status: "authenticated", me });
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest().catch(() => undefined);
    queryClient.clear(); // never show one user's cached data to the next
    setState({ status: "anonymous", me: null });
  }, [queryClient]);

  const refreshMe = useCallback(async () => {
    const me = await fetchMe();
    setState({ status: "authenticated", me });
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status: state.status,
      me: state.me,
      login,
      logout,
      refreshMe,
      can: (p) => permissions.has(p),
      canAny: (ps) => canAny(permissions, ps),
    }),
    [state, permissions, login, logout, refreshMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** The logged-in user's profile. Only call inside routes that require login. */
export function useMe(): MeResponse {
  const { me } = useAuth();
  if (!me) throw new Error("useMe called without a logged-in user");
  return me;
}
