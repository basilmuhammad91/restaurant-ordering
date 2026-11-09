import type {
  AuthResponse,
  Category,
  Deal,
  DealInput,
  MenuItem,
  MenuItemInput,
  Order,
  OrderStatus,
  Page,
  Stats,
  User,
} from "./types";

const BASE = String(import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const TOKEN_KEY = "restoflux_token";

// ---- token storage (localStorage can throw in private mode, so guard it) ----
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

// The AuthProvider registers a callback here, so any request that comes back 401
// (expired/invalid token) logs the user out and redirects to /login.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection and that the API is running.");
  }

  if (res.status === 204) return undefined as T;

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // A 401 from /login just means wrong credentials; only an authenticated request
    // that gets 401 means "your session is no longer valid".
    if (res.status === 401 && token && path !== "/api/auth/login") onUnauthorized?.();
    throw new ApiError(res.status, json?.error ?? `Request failed (${res.status})`, json?.details);
  }
  return json as T;
}

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
};

export const api = {
  auth: {
    register: (b: { name: string; email: string; password: string }) =>
      request<AuthResponse>("POST", "/api/auth/register", b),
    login: (b: { email: string; password: string }) => request<AuthResponse>("POST", "/api/auth/login", b),
    me: () => request<{ user: User }>("GET", "/api/auth/me"),
  },
  categories: {
    list: () => request<{ data: Category[] }>("GET", "/api/categories"),
  },
  menuItems: {
    list: (p: { categoryId?: number; available?: boolean } = {}) =>
      request<{ data: MenuItem[] }>("GET", `/api/menu-items${qs(p)}`),
    create: (b: MenuItemInput) => request<{ data: MenuItem }>("POST", "/api/menu-items", b),
    update: (id: number, b: Partial<MenuItemInput>) =>
      request<{ data: MenuItem }>("PATCH", `/api/menu-items/${id}`, b),
  },
  deals: {
    list: () => request<{ data: Deal[] }>("GET", "/api/deals"), // public: only active deals
    manage: () => request<{ data: Deal[] }>("GET", "/api/deals/manage"), // admin: all deals
    create: (b: DealInput) => request<{ data: Deal }>("POST", "/api/deals", b),
    update: (id: number, b: Partial<DealInput>) => request<{ data: Deal }>("PATCH", `/api/deals/${id}`, b),
    remove: (id: number) => request<void>("DELETE", `/api/deals/${id}`),
  },
  stats: {
    get: (p: { from?: string; to?: string } = {}) => request<Stats>("GET", `/api/stats${qs(p)}`),
  },
  orders: {
    create: (b: {
      items: { menuItemId: number; quantity: number }[];
      deals: { dealId: number; quantity: number }[];
      notes?: string;
    }) =>
      request<{ data: Order }>("POST", "/api/orders", b),
    list: (p: { status?: OrderStatus; page?: number; limit?: number } = {}) =>
      request<Page<Order>>("GET", `/api/orders${qs(p)}`),
    get: (id: number) => request<{ data: Order }>("GET", `/api/orders/${id}`),
    setStatus: (id: number, status: OrderStatus) =>
      request<{ data: Order }>("PATCH", `/api/orders/${id}/status`, { status }),
    cancel: (id: number) => request<{ data: Order }>("POST", `/api/orders/${id}/cancel`),
  },
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}
