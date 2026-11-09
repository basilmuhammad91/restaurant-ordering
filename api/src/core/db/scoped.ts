import { forbidden } from "../http/errors.js";
import { requireContext, type RequestContext } from "../context/context.js";
import { unscopedDb } from "./client.js";
import { metaFor, type ModelMeta } from "./meta.js";

// THE tenancy enforcement point.
//
// Every query made through `db` is rewritten here, using the current request context:
//   1. tenant     : WHERE tenantId = <current tenant>            (and tenantId is stamped on creates)
//   2. soft delete: WHERE deletedAt IS NULL                       (unless the context says includeArchived)
//   3. location   : WHERE locationId IN (<user's branches>)       (unless the user may see all locations)
//
// (Laravel: this is a global scope applied to every Eloquent model, but written once, driven by the
// schema, and covered by a test that fails if a model is not scoped.)
//
// Limits to remember (documented in docs/ARCHITECTURE.md 5.2):
//  - Only top-level operations are intercepted. Relations are same-tenant by composite foreign keys, but
//    soft-delete / location filters are NOT applied inside `include` / `select`: write them explicitly.
//  - Raw SQL ($queryRaw) bypasses this. It is allowed only in reports and the stock ledger via scopeSql().
//  - Use "unchecked" create inputs (scalar tenantId/foreign keys), not nested `connect`, so tenantId can be stamped.

type Where = Record<string, unknown>;
type Args = Record<string, unknown> & { where?: Where; data?: unknown };

const READ_OPS = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy",
]);
const WRITE_WITH_WHERE_OPS = new Set(["update", "updateMany", "updateManyAndReturn", "delete", "deleteMany", "upsert"]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);

/**
 * Add extra conditions to a `where` WITHOUT moving the caller's keys.
 * Prisma's unique operations (findUnique, update, delete) require the unique field (usually `id`) at the
 * TOP LEVEL of `where`; extra filters may sit beside it, so they are appended to a sibling `AND` list.
 */
function addConditions(where: Where | undefined, extras: Where[]): Where | undefined {
  if (extras.length === 0) return where;
  const base: Where = { ...(where ?? {}) };
  const existing = base.AND ? (Array.isArray(base.AND) ? (base.AND as Where[]) : [base.AND as Where]) : [];
  base.AND = [...existing, ...extras];
  return base;
}

function scopeWhere(model: string, meta: ModelMeta, where: Where | undefined, ctx: RequestContext): Where | undefined {
  const extras: Where[] = [];

  if (model === "Tenant") extras.push({ id: ctx.tenantId });
  else if (meta.tenantScoped) extras.push({ tenantId: ctx.tenantId });

  // Hide archived rows unless asked. Writes also skip archived rows (restore uses withArchived()).
  if (meta.softDelete && !ctx.includeArchived && !(where && "deletedAt" in where)) extras.push({ deletedAt: null });

  if (meta.location && !ctx.allLocations) {
    const { field, nullable } = meta.location;
    const inList: Where = { [field]: { in: [...ctx.locationIds] } };
    extras.push(nullable ? { OR: [{ [field]: null }, inList] } : inList);
  }

  return addConditions(where, extras);
}

function stampCreate(model: string, meta: ModelMeta, data: Record<string, unknown>, ctx: RequestContext): Record<string, unknown> {
  const out = { ...data };
  if (meta.tenantScoped) out.tenantId = ctx.tenantId; // never trust a client-supplied tenant
  if (meta.location && !ctx.allLocations && model !== "Location") {
    const value = out[meta.location.field];
    if (typeof value === "string" && !ctx.locationIds.includes(value)) throw forbidden("That branch is outside your access");
  }
  return out;
}

export function scopeArgs(model: string, operation: string, rawArgs: unknown): unknown {
  const meta = metaFor(model);
  if (!meta.tenantScoped && model !== "Tenant") return rawArgs; // shared reference data / legacy tables

  const ctx = requireContext(); // throws when there is no tenant context: fail closed
  const args: Args = { ...((rawArgs as Args) ?? {}) };

  if (READ_OPS.has(operation)) {
    args.where = scopeWhere(model, meta, args.where, ctx);
  } else if (WRITE_WITH_WHERE_OPS.has(operation)) {
    args.where = scopeWhere(model, meta, args.where, ctx);
    if (operation === "upsert" && args.create) args.create = stampCreate(model, meta, args.create as Record<string, unknown>, ctx);
  } else if (CREATE_OPS.has(operation)) {
    const data = args.data;
    args.data = Array.isArray(data)
      ? data.map((row) => stampCreate(model, meta, row as Record<string, unknown>, ctx))
      : stampCreate(model, meta, data as Record<string, unknown>, ctx);
  }
  return args;
}

/**
 * The client every module uses. Same API as PrismaClient, with scoping applied to every query.
 * Interactive transactions (`db.$transaction(async (tx) => ...)`) are scoped too.
 */
export const db = unscopedDb.$extends({
  name: "tenancy",
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        return query(scopeArgs(model, operation, args) as typeof args);
      },
    },
  },
});

export type Db = typeof db;
/** The transaction client handed to `db.$transaction(async (tx) => ...)`: the same client without connection/transaction methods. */
export type Tx = Omit<Db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
