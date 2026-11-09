import {
  idSchema, listQuerySchema, permissionsByModule, roleInputSchema, roleLimitsInputSchema,
  rolePermissionsInputSchema, roleUpdateSchema,
} from "@restoflux/contracts";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext } from "../../core/context/context.js";
import { db, type Tx } from "../../core/db/scoped.js";
import { conflict, fieldError, forbidden, notFound } from "../../core/http/errors.js";
import { offsetMeta, paging, parseSort, searchWhere } from "../../core/http/pagination.js";
import { securedRouter } from "../../core/http/secured.js";
import { bumpAuthVersion } from "../../core/rbac/authVersion.js";
import { limitFor } from "../../core/rbac/policy.js";
import type { Principal } from "../../core/rbac/principal.js";

// ROLES: tenant-defined sets of permissions plus approval thresholds. Editing a role takes effect on
// every affected user's next request (authVersion bump). Rules (tested):
//  - nobody can grant a permission, discount percentage or limit above what they hold themselves
//  - an owner role cannot be reduced, and only an owner can edit it
//  - a role in use cannot be archived

const idParams = z.object({ id: idSchema });

const roleInclude = {
  permissions: { select: { permission: true } },
  limits: { select: { currencyCode: true, voidLimitMinor: true, refundLimitMinor: true, poApprovalLimitMinor: true, adjustmentLimitMinor: true } },
  _count: { select: { users: true } },
} as const;
type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

function toDto(r: RoleRow) {
  const { permissions, _count, maxDiscountPercent, ...rest } = r;
  return { ...rest, maxDiscountPercent: Number(maxDiscountPercent), permissions: permissions.map((p) => p.permission).sort(), userCount: _count.users };
}

async function loadRole(tx: Pick<Tx, "role">, id: string) {
  const role = await tx.role.findFirst({ where: { id }, include: roleInclude });
  if (!role) throw notFound("role");
  return role;
}

function assertCanEdit(actor: Principal, role: { isOwner: boolean }) {
  if (role.isOwner && !actor.isOwner) throw forbidden("Only an owner can edit an owner role");
}

// ---- the permission catalog, for the matrix UI ----
export const permissionsRoutes = securedRouter("/api/v1/permissions");
permissionsRoutes.get("/", "roles.view", async (_req, res) => {
  res.json({ data: permissionsByModule() });
});

export const rolesRoutes = securedRouter("/api/v1/roles");
const { router, get, post, put, patch, delete: del } = rolesRoutes;

get("/", "roles.view", async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const where = { ...(searchWhere(q.q, ["name", "description"]) ?? {}) };
  const [rows, total] = await Promise.all([
    db.role.findMany({ where, include: roleInclude, orderBy: parseSort(q.sort, ["name", "createdAt"], "name") as never, ...paging(q) }),
    db.role.count({ where }),
  ]);
  res.json({ data: rows.map(toDto), meta: offsetMeta(q, total) });
});

get("/:id", "roles.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json({ data: toDto(await loadRole(db, id)) });
});

post("/", "roles.manage", async (req, res) => {
  const actor = req.principal!;
  const input = roleInputSchema.parse(req.body);
  if (!actor.unlimitedLimits && input.maxDiscountPercent > actor.maxDiscountPercent) {
    throw forbidden("You cannot create a role with a discount limit above your own");
  }
  const role = await db.$transaction(async (tx) => {
    const created = await tx.role.create({
      data: { tenantId: requireContext().tenantId, name: input.name, description: input.description ?? null, maxDiscountPercent: input.maxDiscountPercent },
      include: roleInclude,
    });
    await recordAudit(tx, { action: "roles.create", entityType: "Role", entityId: created.id, after: toDto(created) });
    return created;
  });
  res.status(201).json({ data: toDto(role) });
});

patch("/:id", "roles.manage", async (req, res) => {
  const actor = req.principal!;
  const { id } = idParams.parse(req.params);
  const input = roleUpdateSchema.parse(req.body);

  const role = await db.$transaction(async (tx) => {
    const before = await loadRole(tx, id);
    assertCanEdit(actor, before);
    if (before.isOwner && input.maxDiscountPercent !== undefined) throw conflict("An owner role always has a 100% discount limit");
    if (input.maxDiscountPercent !== undefined && !actor.unlimitedLimits && input.maxDiscountPercent > actor.maxDiscountPercent) {
      throw forbidden("You cannot set a discount limit above your own");
    }
    const after = await tx.role.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.maxDiscountPercent !== undefined && { maxDiscountPercent: input.maxDiscountPercent }),
      },
      include: roleInclude,
    });
    await bumpAuthVersion(tx);
    await recordAudit(tx, { action: "roles.update", entityType: "Role", entityId: id, before: toDto(before), after: toDto(after) });
    return after;
  });
  res.json({ data: toDto(role) });
});

// The permission matrix: replace the whole set in one call.
put("/:id/permissions", "roles.manage", async (req, res) => {
  const actor = req.principal!;
  const { id } = idParams.parse(req.params);
  const { permissions } = rolePermissionsInputSchema.parse(req.body);

  const role = await db.$transaction(async (tx) => {
    const before = await loadRole(tx, id);
    assertCanEdit(actor, before);
    if (before.isOwner) throw conflict("An owner role always holds every permission");

    // No escalation: you may only ADD permissions you hold yourself (removing is always allowed).
    const existing = new Set(before.permissions.map((p) => p.permission));
    if (!actor.isOwner) {
      const denied = permissions.filter((p) => !existing.has(p) && !actor.permissions.has(p));
      if (denied.length) throw forbidden(`You cannot grant permissions you do not hold: ${denied.join(", ")}`);
    }

    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ tenantId: requireContext().tenantId, roleId: id, permission })) });
    await bumpAuthVersion(tx);
    const after = await loadRole(tx, id);
    const added = permissions.filter((p) => !existing.has(p)).sort();
    const removed = [...existing].filter((p) => !permissions.includes(p as never)).sort();
    await recordAudit(tx, { action: "roles.permissions.update", entityType: "Role", entityId: id, before: { permissions: [...existing].sort() }, after: { permissions: [...permissions].sort(), added, removed } });
    return after;
  });
  res.json({ data: toDto(role) });
});

put("/:id/limits", "roles.manage", async (req, res) => {
  const actor = req.principal!;
  const { id } = idParams.parse(req.params);
  const { limits } = roleLimitsInputSchema.parse(req.body);
  if (new Set(limits.map((l) => l.currencyCode)).size !== limits.length) throw fieldError("limits", "A currency is listed twice");

  const role = await db.$transaction(async (tx) => {
    const before = await loadRole(tx, id);
    assertCanEdit(actor, before);
    if (before.isOwner || before.unlimitedLimits) throw conflict("This role has unlimited authority; limits do not apply");

    // No escalation: a limit may not exceed the editor's own for that currency (unless the editor is unlimited).
    if (!actor.unlimitedLimits) {
      for (const l of limits) {
        const kinds = [["void", l.voidLimitMinor], ["refund", l.refundLimitMinor], ["purchaseOrder", l.poApprovalLimitMinor], ["adjustment", l.adjustmentLimitMinor]] as const;
        for (const [kind, value] of kinds) {
          const own = limitFor(actor, kind, l.currencyCode) ?? 0;
          if (value > own) throw forbidden(`You cannot set a ${kind} limit above your own (${l.currencyCode})`);
        }
      }
    }
    for (const l of limits) if (!(await tx.currency.findUnique({ where: { code: l.currencyCode } }))) throw fieldError("limits", `Unknown currency ${l.currencyCode}`);

    await tx.roleLimit.deleteMany({ where: { roleId: id } });
    if (limits.length) await tx.roleLimit.createMany({ data: limits.map((l) => ({ ...l, tenantId: requireContext().tenantId, roleId: id })) });
    await bumpAuthVersion(tx);
    const after = await loadRole(tx, id);
    await recordAudit(tx, { action: "roles.limits.update", entityType: "Role", entityId: id, before: { limits: before.limits }, after: { limits: after.limits } });
    return after;
  });
  res.json({ data: toDto(role) });
});

del("/:id", "roles.manage", async (req, res) => {
  const actor = req.principal!;
  const { id } = idParams.parse(req.params);
  await db.$transaction(async (tx) => {
    const before = await loadRole(tx, id);
    assertCanEdit(actor, before);
    if (before.isOwner) throw conflict("An owner role cannot be archived");
    if (before._count.users > 0) throw conflict("This role is assigned to users. Reassign them first.");
    await tx.role.update({ where: { id }, data: { deletedAt: new Date() } });
    await bumpAuthVersion(tx);
    await recordAudit(tx, { action: "roles.archive", entityType: "Role", entityId: id, before: toDto(before) });
  });
  res.status(204).end();
});

export const rolesRouter = router;
export const permissionsRouter = permissionsRoutes.router;
