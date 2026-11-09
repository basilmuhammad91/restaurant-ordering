import type { ApiErrorBody, MeResponse, PlatformMe } from "@restoflux/contracts";

// The admin app's HTTP client for /api/v1. There are TWO independent clients built from one factory:
//   api          restaurant staff   (/api/v1/...)           token + refresh cookie "rf_refresh"
//   platformApi  the Restoflux team (/api/v1/platform/...)  token + refresh cookie "rf_platform"
// Each keeps its own access token, so being signed in to one never affects the other.
//  - the ACCESS token lives only in memory (never localStorage), so XSS cannot read it;
//  - the REFRESH token is an httpOnly cookie that JavaScript cannot touch; `credentials: "include"` sends it;
//  - on a 401 the client refreshes once (single-flight: parallel requests share one refresh) and retries.
// (Laravel/Sanctum SPA analogue: cookie-based session + a short-lived token, once per auth guard.)

const BASE = `${String(import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "")}/api/v1`;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[]; [k: string]: unknown },
    public requestId?: string,
  ) {
    super(message);
  }
  /** Per-field validation messages from a 422, keyed by field name. */
  get fieldErrors(): Record<string, string[]> {
    return this.details?.fieldErrors ?? {};
  }
}

type Query = Record<string, string | number | boolean | undefined | null | string[]>;

function qs(query?: Query): string {
  if (!query) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function createClient(prefix: "" | "/platform") {
  const authPath = `${prefix}/auth`;
  let accessToken: string | null = null;
  let onSessionLost: (() => void) | null = null;
  let refreshing: Promise<boolean> | null = null;

  /** Exchange the refresh cookie for a new access token. Returns false when there is no valid session. */
  const refreshSession = (): Promise<boolean> => {
    refreshing ??= (async () => {
      try {
        const res = await fetch(`${BASE}${authPath}/refresh`, { method: "POST", credentials: "include" });
        if (!res.ok) return false;
        accessToken = ((await res.json()) as { data: { accessToken: string } }).data.accessToken;
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  };

  async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; retried?: boolean } = {}): Promise<T> {
    const full = `${prefix}${path}`;
    let res: Response;
    try {
      res = await fetch(`${BASE}${full}${qs(opts.query)}`, {
        method,
        credentials: "include",
        headers: {
          ...(opts.body !== undefined && { "Content-Type": "application/json" }),
          ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        },
        ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
      });
    } catch {
      throw new ApiError(0, "NETWORK", "Cannot reach the server. Check your connection and that the API is running.");
    }

    if (res.status === 401 && !opts.retried && !full.startsWith(`${authPath}/login`) && !full.startsWith(`${authPath}/refresh`)) {
      if (await refreshSession()) return request<T>(method, path, { ...opts, retried: true });
      onSessionLost?.();
    }
    if (res.status === 204) return undefined as T;

    const json = (await res.json().catch(() => null)) as (ApiErrorBody & Record<string, unknown>) | null;
    if (!res.ok) {
      const e = json?.error;
      throw new ApiError(res.status, e?.code ?? "INTERNAL", e?.message ?? `Request failed (${res.status})`, e?.details as ApiError["details"], e?.requestId);
    }
    return json as T;
  }

  return {
    api: {
      get: <T>(path: string, query?: Query) => request<T>("GET", path, query ? { query } : {}),
      post: <T>(path: string, body?: unknown) => request<T>("POST", path, body !== undefined ? { body } : {}),
      put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body !== undefined ? { body } : {}),
      patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body !== undefined ? { body } : {}),
      del: <T = void>(path: string) => request<T>("DELETE", path),
    },
    setAccessToken: (token: string | null) => {
      accessToken = token;
    },
    /** Called when a request cannot be authenticated even after a refresh (the user must log in again). */
    setSessionLostHandler: (fn: (() => void) | null) => {
      onSessionLost = fn;
    },
    refreshSession,
    async login<TMe>(email: string, password: string): Promise<TMe> {
      const res = await request<{ data: { accessToken: string; me: TMe } }>("POST", "/auth/login", { body: { email, password } });
      accessToken = res.data.accessToken;
      return res.data.me;
    },
    async logoutRequest(): Promise<void> {
      try {
        await request("POST", "/auth/logout");
      } finally {
        accessToken = null;
      }
    },
    fetchMe: async <TMe>(): Promise<TMe> => (await request<{ data: TMe }>("GET", "/auth/me")).data,
  };
}

// ---- restaurant staff (the existing exports keep their names) ----
const staff = createClient("");
export const api = staff.api;
export const setAccessToken = staff.setAccessToken;
export const setSessionLostHandler = staff.setSessionLostHandler;
export const refreshSession = staff.refreshSession;
export const login = (email: string, password: string) => staff.login<MeResponse>(email, password);
export const logoutRequest = staff.logoutRequest;
export const fetchMe = () => staff.fetchMe<MeResponse>();

// ---- the Restoflux team ----
const platform = createClient("/platform");
export const platformApi = platform.api;
export const platformClient = {
  setAccessToken: platform.setAccessToken,
  setSessionLostHandler: platform.setSessionLostHandler,
  refreshSession: platform.refreshSession,
  login: (email: string, password: string) => platform.login<PlatformMe>(email, password),
  logout: platform.logoutRequest,
  fetchMe: () => platform.fetchMe<PlatformMe>(),
};

// ---- typed helpers for the envelopes ----
export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}
export interface Cursored<T> {
  data: T[];
  meta: { nextCursor: string | null; unreadCount?: number };
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong");
