import { AsyncLocalStorage } from "node:async_hooks";

// The "current request" without passing it through every function.
// (Laravel: like the request()/auth() helpers, or a per-request scoped singleton.)
//
// AsyncLocalStorage keeps a value alive across awaits for the duration of one request, which is how
// the database layer knows which tenant (and which branches) to scope every query to.

export type ActorType = "USER" | "SYSTEM" | "CUSTOMER";

export interface RequestContext {
  requestId: string;
  tenantId: string;
  userId: string | null;
  actorType: ActorType;
  /** true = the actor may see every location of the tenant. */
  allLocations: boolean;
  /** Allowed location ids (ignored when allLocations). */
  locationIds: readonly string[];
  /** When true, soft-deleted (archived) rows are visible. Set only via withArchived(). */
  includeArchived: boolean;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn);

export const getContext = (): RequestContext | undefined => storage.getStore();

/** Fails closed: no tenant context means an error, never "all rows". */
export function requireContext(): RequestContext {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("No request context: tenant-scoped data can only be used inside a request, runAsTenant() or a test fixture.");
  return ctx;
}

/**
 * Run something as a tenant outside a request (jobs, seeds, scripts, tests). Sees every location.
 *
 * It awaits `fn` INSIDE the context on purpose: Prisma queries are lazy (they run when awaited), so
 * returning an un-awaited query from the callback would execute it after the context has closed.
 */
export async function runAsTenant<T>(tenantId: string, fn: () => T | Promise<T>, overrides: Partial<RequestContext> = {}): Promise<Awaited<T>> {
  return storage.run(
    {
      requestId: "system",
      tenantId,
      userId: null,
      actorType: "SYSTEM",
      allLocations: true,
      locationIds: [],
      includeArchived: false,
      ...overrides,
    },
    async () => await fn(),
  ) as Promise<Awaited<T>>;
}

/** Run with archived (soft-deleted) rows visible, e.g. for "restore" and admin "show archived" views. */
export function withArchived<T>(fn: () => T): T {
  return storage.run({ ...requireContext(), includeArchived: true }, fn);
}
