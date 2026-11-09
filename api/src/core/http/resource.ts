import { idSchema, listQuerySchema, type PermissionKey } from "@restoflux/contracts";
import { z } from "zod";
import { recordAudit } from "../audit/audit.js";
import { requireContext, withArchived } from "../context/context.js";
import { db, type Db, type Tx } from "../db/scoped.js";
import { notFound, validationError } from "./errors.js";
import { offsetMeta, paging, parseSort, searchWhere } from "./pagination.js";
import { securedRouter } from "./secured.js";

// A small CRUD factory for master-data resources (brands, tax profiles, payment methods, ...).
// Produces: GET / (list: search, filter, sort, paginate), GET /:id, POST /, PATCH /:id,
// DELETE /:id (archive = soft delete) and POST /:id/restore, every one permission-gated, scoped
// to the tenant (via `db`) and audited.
// (Laravel: Route::apiResource + a base controller. Resources with real business rules, like users and
// roles, are written by hand instead of squeezing them into this.)

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRecord = Record<string, any>;

interface Delegate {
  findMany(args: AnyRecord): Promise<AnyRecord[]>;
  count(args: AnyRecord): Promise<number>;
  findFirst(args: AnyRecord): Promise<AnyRecord | null>;
  create(args: AnyRecord): Promise<AnyRecord>;
  update(args: AnyRecord): Promise<AnyRecord>;
  delete(args: AnyRecord): Promise<AnyRecord>;
}

type Perms = PermissionKey | PermissionKey[];

export interface ResourceConfig {
  mount: string; // "/api/v1/brands"
  label: string; // "brand" (used in messages)
  entityType: string; // "Brand" (audit)
  auditPrefix: string; // "brands" -> brands.create, brands.update, brands.archive, brands.restore
  model: (client: Db | Tx) => Delegate;
  permissions: { read: Perms; write: Perms };
  createSchema?: z.ZodType; // omit for read-only resources
  updateSchema?: z.ZodType;
  searchFields: string[];
  sortable: string[];
  defaultSort: string;
  /** Extra query filters, e.g. { brandId: idSchema.optional(), isActive: boolString.optional() } */
  filters?: Record<string, z.ZodType>;
  include?: AnyRecord;
  /** true when the model has no deletedAt: DELETE removes the row. */
  hardDelete?: boolean;
  /** Validate references and normalise input; may throw. `existing` is set on update. */
  prepare?: (input: AnyRecord, ctx: { tx: Tx; existing?: AnyRecord }) => Promise<AnyRecord> | AnyRecord;
  /** Override the audit action name for an update (e.g. "locations.settings.update"). */
  updateAuditAction?: (before: AnyRecord, after: AnyRecord) => string;
  /** The location a row belongs to, for audit scoping. */
  locationIdOf?: (row: AnyRecord) => string | null;
}

/** "true"/"false" query values to booleans. */
export const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");

const idParams = z.object({ id: idSchema });

export function defineResource(cfg: ResourceConfig) {
  const { router, get, post, patch, delete: del } = securedRouter(cfg.mount);
  const read = cfg.permissions.read;
  const write = cfg.permissions.write;

  const listSchema = listQuerySchema.extend(
    Object.fromEntries(Object.entries(cfg.filters ?? {}).map(([k, v]) => [k, v])) as Record<string, z.ZodType>,
  );
  const prepare = async (tx: Tx, input: AnyRecord, existing?: AnyRecord) =>
    cfg.prepare ? cfg.prepare(input, { tx, ...(existing ? { existing } : {}) }) : input;
  const locationOf = (row: AnyRecord | null) => (row && cfg.locationIdOf ? cfg.locationIdOf(row) : null);

  get("/", read, async (req, res) => {
    const q = listSchema.parse(req.query) as AnyRecord;
    const filters = Object.fromEntries(Object.keys(cfg.filters ?? {}).filter((k) => q[k] !== undefined).map((k) => [k, q[k]]));
    const where = { ...filters, ...(searchWhere(q.q, cfg.searchFields) ?? {}) };
    const run = <T>(fn: () => T) => (q.includeArchived ? withArchived(fn) : fn());

    const [rows, total] = await run(() =>
      Promise.all([
        cfg.model(db).findMany({
          where,
          orderBy: parseSort(q.sort, cfg.sortable, cfg.defaultSort),
          ...paging({ page: q.page, pageSize: q.pageSize }),
          ...(cfg.include ? { include: cfg.include } : {}),
        }),
        cfg.model(db).count({ where }),
      ]),
    );
    res.json({ data: rows, meta: offsetMeta(q as { page: number; pageSize: number }, total) });
  });

  get("/:id", read, async (req, res) => {
    const { id } = idParams.parse(req.params);
    const row = await cfg.model(db).findFirst({ where: { id }, ...(cfg.include ? { include: cfg.include } : {}) });
    if (!row) throw notFound(cfg.label);
    res.json({ data: row });
  });

  if (cfg.createSchema) {
    post("/", write, async (req, res) => {
      const input = cfg.createSchema!.parse(req.body) as AnyRecord;
      const row = await db.$transaction(async (tx) => {
        const data = await prepare(tx, input);
        const created = await cfg.model(tx).create({ data: { ...data, tenantId: requireContext().tenantId }, ...(cfg.include ? { include: cfg.include } : {}) });
        await recordAudit(tx, { action: `${cfg.auditPrefix}.create`, entityType: cfg.entityType, entityId: created.id, after: created, locationId: locationOf(created) });
        return created;
      });
      res.status(201).json({ data: row });
    });
  }

  if (cfg.updateSchema) {
    patch("/:id", write, async (req, res) => {
      const { id } = idParams.parse(req.params);
      const input = cfg.updateSchema!.parse(req.body) as AnyRecord;
      const row = await db.$transaction(async (tx) => {
        const before = await cfg.model(tx).findFirst({ where: { id } });
        if (!before) throw notFound(cfg.label);
        const data = await prepare(tx, input, before);
        const after = await cfg.model(tx).update({ where: { id }, data, ...(cfg.include ? { include: cfg.include } : {}) });
        await recordAudit(tx, {
          action: cfg.updateAuditAction?.(before, after) ?? `${cfg.auditPrefix}.update`,
          entityType: cfg.entityType,
          entityId: id,
          before,
          after,
          locationId: locationOf(after),
        });
        return after;
      });
      res.json({ data: row });
    });
  }

  if (cfg.createSchema) {
    del("/:id", write, async (req, res) => {
      const { id } = idParams.parse(req.params);
      await db.$transaction(async (tx) => {
        const before = await cfg.model(tx).findFirst({ where: { id } });
        if (!before) throw notFound(cfg.label);
        if (cfg.hardDelete) {
          await cfg.model(tx).delete({ where: { id } });
          await recordAudit(tx, { action: `${cfg.auditPrefix}.delete`, entityType: cfg.entityType, entityId: id, before, locationId: locationOf(before) });
        } else {
          const after = await cfg.model(tx).update({ where: { id }, data: { deletedAt: new Date() } });
          await recordAudit(tx, { action: `${cfg.auditPrefix}.archive`, entityType: cfg.entityType, entityId: id, before, after, locationId: locationOf(before) });
        }
      });
      res.status(204).end();
    });

    if (!cfg.hardDelete) {
      post("/:id/restore", write, async (req, res) => {
        const { id } = idParams.parse(req.params);
        const row = await withArchived(() =>
          db.$transaction(async (tx) => {
            const before = await cfg.model(tx).findFirst({ where: { id, deletedAt: { not: null } } });
            if (!before) throw notFound(cfg.label);
            const after = await cfg.model(tx).update({ where: { id }, data: { deletedAt: null } });
            await recordAudit(tx, { action: `${cfg.auditPrefix}.restore`, entityType: cfg.entityType, entityId: id, before, after, locationId: locationOf(after) });
            return after;
          }),
        );
        res.json({ data: row });
      });
    }
  }

  return router;
}

/**
 * Check that a referenced record exists in the current tenant (the scoped client hides other tenants').
 * Optional references (null/undefined) pass. Returns the row so callers can inspect it.
 */
export async function assertRef(
  model: { findFirst(args: AnyRecord): Promise<AnyRecord | null> },
  id: string | null | undefined,
  label: string,
  where: AnyRecord = {},
): Promise<AnyRecord | null> {
  if (!id) return null;
  const row = await model.findFirst({ where: { id, ...where } });
  if (!row) throw validationError(`Unknown ${label}`, { formErrors: [], fieldErrors: { [`${label}Id`]: [`That ${label} does not exist`] } });
  return row;
}
