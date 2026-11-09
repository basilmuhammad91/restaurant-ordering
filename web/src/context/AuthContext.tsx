import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { api, getToken, setToken, setUnauthorizedHandler } from "../lib/api";
import type { User } from "../lib/types";

interface AuthState {
  user: User | null;
  loading: boolean; // true while we verify a stored token on first load
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => getToken() !== null);
  const navigate = useNavigate();

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  // On any 401 from an authenticated request: drop the session, go to /login,
  // and remember where the user was so we can send them back after login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
      navigate("/login", { replace: true, state: { from: window.location.pathname, expired: true } });
    });
    return () => setUnauthorizedHandler(null);
  }, [logout, navigate]);

  // Restore the session from a stored token (like Auth::user() on each request).
  useEffect(() => {
    if (!getToken()) return;
    api.auth
      .me()
      .then((r) => setUser(r.user))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.auth.login({ email, password });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const r = await api.auth.register({ name, email, password });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
