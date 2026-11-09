import {
  cursorQuerySchema, idSchema, listQuerySchema, userCreateSchema, userLocationsInputSchema,
  userPasswordResetSchema, userPinInputSchema, userRolesInputSchema, userUpdateSchema, USER_STATUSES,
} from "@restoflux/contracts";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { hashPassword } from "../../core/auth/passwords.js";
import { revokeSession, revokeUserSessions } from "../../core/auth/sessions.js";
import { assertWithinPlanLimit } from "../../core/rbac/planLimits.js";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext } from "../../core/context/context.js";
import { db, type Tx } from "../../core/db/scoped.js";
import { conflict, fieldError, forbidden, notFound } from "../../core/http/errors.js";
import { afterCursor, encodeCursor, offsetMeta, paging, parseSort, searchWhere } from "../../core/http/pagination.js";
import { securedRouter } from "../../core/http/secured.js";
import { bumpAuthVersion } from "../../core/rbac/authVersion.js";
import type { Principal } from "../../core/rbac/principal.js";

// USERS: staff accounts. Rules that matter (all tested):
//  - you cannot grant a role holding permissions you do not have (no privilege escalation)
//  - only an owner can assign owner roles; the last active owner cannot be removed, disabled or archived
//  - a user limited to some branches only sees, and can only assign, users/branches inside their own scope
//  - disabling or archiving a user revokes their sessions at once; role/branch changes apply on the next request

export const usersRoutes = securedRouter("/api/v1/users");
const { router, get, post, put, patch, delete: del } = usersRoutes;

const idParams = z.object({ id: idSchema });
const FINANCIAL_PERMISSIONS = ["dashboard.financial.view", "reports.financial.view"];

// What the API returns for a user: never password or PIN hashes.
const userSelect = {
  id: true, email: true, name: true, phone: true, status: true, allLocations: true, locale: true,
  lastLoginAt: true, createdAt: true, updatedAt: true, deletedAt: true, posPinHash: true,
  roles: { select: { role: { select: { id: true, name: true, isOwner: true } } } },
  locations: { select: { locationId: true } },
} as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function toDto(u: UserRow) {
  const { posPinHash, roles, locations, ...rest } = u;
  return { ...rest, hasPin: posPinHash !== null, roles: roles.map((r) => r.role), locationIds: locations.map((l) => l.locationId) };
}

/** Users a limited-scope actor may see: those assigned to at least one of the actor's branches. */
function visibleTo(actor: Principal): Record<string, unknown> {
  return actor.allLocations ? {} : { locations: { some: { locationId: { in: actor.locationIds } } } };
}

async function loadVisible(tx: Pick<Tx, "user">, actor: Principal, id: string) {
  const user = await tx.user.findFirst({ where: { id, ...visibleTo(actor) }, select: userSelect });
  if (!user) throw notFound("user");
  return user;
}

/** Privilege-escalation guard: you may only assign roles whose permissions you already hold. */
async function assertCanAssignRoles(tx: Tx, actor: Principal, roleIds: string[]) {
  const roles = await tx.role.findMany({ where: { id: { in: roleIds } }, include: { permissions: true } });
  if (roles.length !== new Set(roleIds).size) throw fieldError("roleIds", "One or more roles do not exist");
  if (!actor.isOwner) {
    for (const role of roles) {
      if (role.isOwner) throw forbidden("Only an owner can assign an owner role");
      for (const p of role.permissions) {
        if (!actor.permissions.has(p.permission)) throw forbidden(`You cannot grant the "${role.name}" role: it includes permissions you do not hold`);
      }
    }
  }
  return roles;
}

function assertCanAssignLocations(actor: Principal, input: { allLocations: boolean; locationIds: string[] }) {
  if (actor.allLocations) return;
  if (input.allLocations) throw forbidden("Only users with access to all branches can grant access to all branches");
  if (input.locationIds.some((l) => !actor.locationIds.includes(l))) throw forbidden("You can only assign branches you have access to");
}

async function assertLocationsExist(tx: Tx, locationIds: string[]) {
  if (!locationIds.length) return;
  const found = await tx.location.count({ where: { id: { in: locationIds } } });
  if (found !== new Set(locationIds).size) throw fieldError("locationIds", "One or more branches do not exist");
}

/** True when the user currently holds an owner role. */
const isOwnerUser = (u: { roles: { role: { isOwner: boolean } }[] }) => u.roles.some((r) => r.role.isOwner);

async function assertAnotherOwnerRemains(tx: Pick<Tx, "user">, userId: string) {
  const others = await tx.user.count({
    where: { id: { not: userId }, status: "ACTIVE", roles: { some: { role: { isOwner: true, deletedAt: null } } } },
  });
  if (others === 0) throw conflict("This is the last active owner. Assign another owner first.");
}

const mustBeStrong = (roles: { isOwner: boolean; permissions: { permission: string }[] }[]) =>
  roles.some((r) => r.isOwner || r.permissions.some((p) => FINANCIAL_PERMISSIONS.includes(p.permission)));

// ---- list / get ----
get("/", "users.view", async (req, res) => {
  const actor = req.principal!;
  const q = listQuerySchema
    .extend({ status: z.enum(USER_STATUSES).optional(), roleId: idSchema.optional(), locationId: idSchema.optional() })
    .parse(req.query);

  const where = {
    ...visibleTo(actor),
    ...(q.status && { status: q.status }),
    ...(q.roleId && { roles: { some: { roleId: q.roleId } } }),
    ...(q.locationId && { locations: { some: { locationId: q.locationId } } }),
    ...(searchWhere(q.q, ["name", "email", "phone"]) ?? {}),
  };
  const [rows, total] = await Promise.all([
    db.user.findMany({ where, select: userSelect, orderBy: parseSort(q.sort, ["name", "email", "createdAt", "lastLoginAt"], "name") as never, ...paging(q) }),
    db.user.count({ where }),
  ]);
  res.json({ data: rows.map(toDto), meta: offsetMeta(q, total) });
});

get("/:id", "users.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json({ data: toDto(await loadVisible(db, req.principal!, id)) });
});

// ---- create ----
post("/", "users.manage", async (req, res) => {
  const actor = req.principal!;
  const input = userCreateSchema.parse(req.body);
  assertCanAssignLocations(actor, input);

  const user = await db.$transaction(async (tx) => {
    await assertWithinPlanLimit(tx, "users");
    const roles = await assertCanAssignRoles(tx, actor, input.roleIds);
    await assertLocationsExist(tx, input.locationIds);
    if (mustBeStrong(roles) && input.password.length < 12) throw fieldError("password", "Roles with financial access need a password of at least 12 characters");

    const created = await tx.user.create({
      data: {
        tenantId: requireContext().tenantId,
        email: input.email,
        name: input.name,
        phone: input.phone ?? null,
        passwordHash: await hashPassword(input.password),
        allLocations: input.allLocations,
        locale: input.locale ?? "en",
        roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
        locations: { create: input.allLocations ? [] : input.locationIds.map((locationId) => ({ locationId })) },
      },
      select: userSelect,
    });
    await bumpAuthVersion(tx);
    await recordAudit(tx, { action: "users.create", entityType: "User", entityId: created.id, after: toDto(created) });
    return created;
  });
  res.status(201).json({ data: toDto(user) });
});

// ---- profile fields and status ----
patch("/:id", "users.manage", async (req, res) => {
  const actor = req.principal!;
  const { id } = idParams.parse(req.params);
  const input = userUpdateSchema.parse(req.body);

  const user = await db.$transaction(async (tx) => {
    const before = await loadVisible(tx, actor, id);
    if (isOwnerUser(before) && !actor.isOwner) throw forbidden("Only an owner can modify an owner");
    const disabling = input.status && input.status !== "ACTIVE" && before.status === "ACTIVE";
    if (disabling) {
      if (id === actor.userId) throw forbidden("You cannot disable your own account");
      if (isOwnerUser(before)) await assertAnotherOwnerRemains(tx, id);
    }
    const after = await tx.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.locale !== undefined && { locale: input.locale }),
      },
      select: userSelect,
    });
    if (disabling) await bumpAuthVersion(tx);
    await recordAudit(tx, { action: disabling ? "users.disable" : "users.update", entityType: "User", entityId: id, before: toDto(before), after: toDto(after) });
    return { after, disabling };
  });
  if (user.disabling) await revokeUserSessions(id); // takes effect immediately
  res.json({ data: toDto(user.after) });
});

// ---- roles and branch access ----
put("/:id/roles", "users.manage", async (req, res) => {
  const actor = req.principal!;
  const { id } = idParams.parse(req.params);
  const { roleIds } = userRolesInputSchema.parse(req.body);

  const after = await db.$transaction(async (tx) => {
    const before = await loadVisible(tx, actor, id);
    if (isOwnerUser(before) && !actor.isOwner) throw forbidden("Only an owner can modify an owner");
    await assertCanAssignRoles(tx, actor, roleIds);

    const ownerRoleIds = new Set(before.roles.filter((r) => r.role.isOwner).map((r) => r.role.id));
    const keepsOwner = [...ownerRoleIds].some((rid) => roleIds.includes(rid));
    if (ownerRoleIds.size > 0 && !keepsOwner) await assertAnotherOwnerRemains(tx, id);

    await tx.userRole.deleteMany({ where: { userId: id } });
    await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ tenantId: requireContext().tenantId, userId: id, roleId })) });
    await bumpAuthVersion(tx);
    const updated = await tx.user.findFirstOrThrow({ where: { id }, select: userSelect });
    await recordAudit(tx, { action: "users.roles.update", entityType: "User", entityId: id, before: { roles: before.roles.map((r) => r.role) }, after: { roles: updated.roles.map((r) => r.role) } });
    return updated;
  });
  res.json({ data: toDto(after) });
});

put("/:id/locations", "users.manage", async (req, res) => {
  const actor = req.principal!;
  const { id } = idParams.parse(req.params);
  const input = userLocationsInputSchema.parse(req.body);
  assertCanAssignLocations(actor, input);

  const after = await db.$transaction(async (tx) => {
    const before = await loadVisible(tx, actor, id);
    if (isOwnerUser(before) && !actor.isOwner) throw forbidden("Only an owner can modify an owner");
    await assertLocationsExist(tx, input.locationIds);

    await tx.userLocation.deleteMany({ where: { userId: id } });
    if (!input.allLocations && input.locationIds.length) {
      await tx.userLocation.createMany({ data: input.locationIds.map((locationId) => ({ tenantId: requireContext().tenantId, userId: id, locationId })) });
    }
    await tx.user.update({ where: { id }, data: { allLocations: input.allLocations } });
    await bumpAuthVersion(tx);
    const updated = await tx.user.findFirstOrThrow({ where: { id }, select: userSelect });
    await recordAudit(tx, {
      action: "users.locations.update", entityType: "User", entityId: id,
      before: { allLocations: before.allLocations, locationIds: before.locations.map((l) => l.locationId) },
      after: { allLocations: updated.allLocations, locationIds: updated.locations.map((l) => l.locationId) },
    });
    return updated;
  });
  res.json({ data: toDto(after) });
});

// ---- credentials ----
post("/:id/reset-password", "users.manage", async (req, res) => {
  const actor = req.principal!;
  const { id } = idParams.parse(req.params);
  const { password } = userPasswordResetSchema.parse(req.body);

  await db.$transaction(async (tx) => {
    const target = await loadVisible(tx, actor, id);
    if (isOwnerUser(target) && !actor.isOwner) throw forbidden("Only an owner can reset an owner's password");
    const strong = await tx.role.findMany({ where: { users: { some: { userId: id } } }, include: { permissions: true } });
    if (mustBeStrong(strong) && password.length < 12) throw fieldError("password", "Roles with financial access need a password of at least 12 characters");
    await tx.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
    await recordAudit(tx, { action: "users.password.reset", entityType: "User", entityId: id, after: { passwordReset: true } });
  });
  await revokeUserSessions(id); // old sessions must not outlive a password reset
  res.status(204).end();
});

put("/:id/pin", "users.manage", async (req, res) => {
  const actor = req.principal!;
  const { id } = idParams.parse(req.params);
  const { pin } = userPinInputSchema.parse(req.body);
  await db.$transaction(async (tx) => {
    const target = await loadVisible(tx, actor, id);
    if (isOwnerUser(target) && !actor.isOwner) throw forbidden("Only an owner can set an owner's PIN");
    await tx.user.update({ where: { id }, data: { posPinHash: await hashPassword(pin), pinFailedAttempts: 0, pinLockedUntil: null } });
    await recordAudit(tx, { action: "users.pin.set", entityType: "User", entityId: id, after: { pinSet: true } });
  });
  res.status(204).end();
});

// ---- archive ----
del("/:id", "users.manage", async (req, res) => {
  const actor = req.principal!;
  const { id } = idParams.parse(req.params);
  await db.$transaction(async (tx) => {
    const before = await loadVisible(tx, actor, id);
    if (id === actor.userId) throw forbidden("You cannot archive your own account");
    if (isOwnerUser(before)) {
      if (!actor.isOwner) throw forbidden("Only an owner can archive an owner");
      await assertAnotherOwnerRemains(tx, id);
    }
    await tx.user.update({ where: { id }, data: { deletedAt: new Date(), status: "DISABLED" } });
    await bumpAuthVersion(tx);
    await recordAudit(tx, { action: "users.archive", entityType: "User", entityId: id, before: toDto(before) });
  });
  await revokeUserSessions(id);
  res.status(204).end();
});

// ---- login history and sessions ----
get("/:id/login-history", "users.view", async (req, res) => {
  const actor = req.principal!;
  const { id } = idParams.parse(req.params);
  const q = cursorQuerySchema.parse(req.query);
  await loadVisible(db, actor, id);

  const rows = await db.loginEvent.findMany({
    where: { userId: id, ...(afterCursor("occurredAt", q.cursor) ?? {}) },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  res.json({ data: page, meta: { nextCursor: rows.length > q.limit && last ? encodeCursor(last.occurredAt, last.id) : null } });
});

get("/:id/sessions", "users.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  await loadVisible(db, req.principal!, id);
  const sessions = await db.session.findMany({
    where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    orderBy: { lastUsedAt: "desc" },
  });
  res.json({ data: sessions });
});

del("/:id/sessions/:sessionId", "users.manage", async (req, res) => {
  const { id, sessionId } = z.object({ id: idSchema, sessionId: idSchema }).parse(req.params);
  await db.$transaction(async (tx) => {
    await loadVisible(tx, req.principal!, id);
    const session = await tx.session.findFirst({ where: { id: sessionId, userId: id } });
    if (!session) throw notFound("session");
    await recordAudit(tx, { action: "users.session.revoke", entityType: "User", entityId: id, after: { sessionId } });
  });
  await revokeSession(sessionId);
  res.status(204).end();
});

export const usersRouter = router;
