import { randomBytes } from "node:crypto";
import {
  loginInputSchema, organizationCreateSchema, organizationListQuerySchema, organizationStatusSchema,
  organizationUpdateSchema, platformUserCreateSchema, cursorQuerySchema, idSchema, passwordSchema,
  type OrganizationRow, type PlatformMe,
} from "@restoflux/contracts";
import type { Prisma } from "../../generated/prisma/client.js";
import { z } from "zod";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../../core/auth/passwords.js";
import { env } from "../../core/config/env.js";
import { unscopedDb } from "../../core/db/client.js";
import { conflict, fieldError, notFound, unauthenticated, validationError } from "../../core/http/errors.js";
import { afterCursor, encodeCursor, offsetMeta, paging, parseSort, searchWhere } from "../../core/http/pagination.js";
import { rateLimit } from "../../core/http/rateLimit.js";
import { recordPlatformAudit } from "../../core/platform/audit.js";
import {
  clearPlatformCookie, createPlatformSession, readPlatformCookie, revokePlatformSessionByToken, revokePlatformUserSessions,
  rotatePlatformSession, setPlatformCookie, signPlatformToken,
} from "../../core/platform/auth.js";
import { platformRouter } from "../../core/platform/secured.js";
import { createTenant } from "../org/provision.js";

// THE PLATFORM CONSOLE API (/api/v1/platform): for the Restoflux team only, never for restaurant staff.
// It manages organizations (tenants): create, suspend, change plan and limits, reset an owner's password.
// Every change is written to the platform audit log. (Laravel: an admin panel guard above the tenants.)

const FAIL_MESSAGE = "Invalid email or password";
const clientMeta = (req: { ip?: string | undefined; get: (h: string) => string | undefined }) => ({ ip: req.ip, userAgent: req.get("user-agent") });
const generatedPassword = () => randomBytes(15).toString("base64url"); // 20 chars, shown once

// ---------------------------------------------------------------- auth
export const platformAuth = platformRouter("/api/v1/platform/auth");

platformAuth.post(
  "/login",
  "public",
  rateLimit({ name: "platform-login", max: 10, windowMs: 60_000, key: (req) => `${req.ip}:${String((req.body as { email?: unknown })?.email ?? "").toLowerCase()}` }),
  async (req, res) => {
    const { email, password } = loginInputSchema.parse(req.body);
    const user = await unscopedDb.platformUser.findUnique({ where: { email } });
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH); // always compare: no timing leak
    if (!user || !ok || user.status !== "ACTIVE") throw unauthenticated(FAIL_MESSAGE);

    const meta = clientMeta(req);
    const { session, refreshToken } = await createPlatformSession(user.id, meta);
    await unscopedDb.platformUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    setPlatformCookie(res, refreshToken);
    const me: PlatformMe = { id: user.id, name: user.name, email: user.email };
    res.json({ data: { accessToken: signPlatformToken({ platformUserId: user.id, sessionId: session.id }), expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, me } });
  },
);

platformAuth.post("/refresh", "public", rateLimit({ name: "platform-refresh", max: 60, windowMs: 60_000 }), async (req, res) => {
  const cookie = readPlatformCookie(req.headers.cookie);
  if (!cookie) throw unauthenticated("No refresh token");
  const { session, refreshToken } = await rotatePlatformSession(cookie, clientMeta(req));
  setPlatformCookie(res, refreshToken);
  res.json({ data: { accessToken: signPlatformToken({ platformUserId: session.platformUserId, sessionId: session.id }), expiresIn: env.ACCESS_TOKEN_TTL_SECONDS } });
});

platformAuth.post("/logout", "public", async (req, res) => {
  const cookie = readPlatformCookie(req.headers.cookie);
  if (cookie) await revokePlatformSessionByToken(cookie);
  clearPlatformCookie(res);
  res.status(204).end();
});

platformAuth.get("/me", "platform", (req, res) => {
  const { id, name, email } = req.platformUser!;
  res.json({ data: { id, name, email } satisfies PlatformMe });
});

// ---------------------------------------------------------------- organizations
export const organizations = platformRouter("/api/v1/platform/organizations");

const tenantSelect = {
  id: true, name: true, slug: true, status: true, plan: true, baseCurrency: true, trialEndsAt: true,
  maxLocations: true, maxUsers: true, suspendedReason: true, createdAt: true,
  _count: { select: { brands: { where: { deletedAt: null } }, locations: { where: { deletedAt: null } }, users: { where: { deletedAt: null } } } },
} satisfies Prisma.TenantSelect;
type TenantRow = Prisma.TenantGetPayload<{ select: typeof tenantSelect }>;

const toRow = (t: TenantRow, lastActivityAt: Date | null): OrganizationRow => ({
  id: t.id, name: t.name, slug: t.slug, status: t.status, plan: t.plan, baseCurrency: t.baseCurrency,
  trialEndsAt: t.trialEndsAt?.toISOString() ?? null, maxLocations: t.maxLocations, maxUsers: t.maxUsers,
  suspendedReason: t.suspendedReason, createdAt: t.createdAt.toISOString(),
  counts: { brands: t._count.brands, locations: t._count.locations, users: t._count.users },
  lastActivityAt: lastActivityAt?.toISOString() ?? null,
});

async function lastActivity(ids: string[]): Promise<Map<string, Date>> {
  if (!ids.length) return new Map();
  const rows = await unscopedDb.session.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids } }, _max: { lastUsedAt: true } });
  return new Map(rows.filter((r) => r._max.lastUsedAt).map((r) => [r.tenantId, r._max.lastUsedAt!]));
}

const loadOrg = async (id: string) => {
  const t = await unscopedDb.tenant.findUnique({ where: { id: idSchema.parse(id) }, select: tenantSelect });
  if (!t) throw notFound("Organization");
  return t;
};

organizations.get("/", "platform", async (req, res) => {
  const q = organizationListQuerySchema.parse(req.query);
  const where: Prisma.TenantWhereInput = { ...(q.status && { status: q.status }), ...searchWhere(q.q, ["name", "slug"]) };
  const [rows, total] = await Promise.all([
    unscopedDb.tenant.findMany({ where, select: tenantSelect, orderBy: parseSort(q.sort, ["name", "createdAt", "status", "plan"], "-createdAt") as never, ...paging(q) }),
    unscopedDb.tenant.count({ where }),
  ]);
  const activity = await lastActivity(rows.map((r) => r.id));
  res.json({ data: rows.map((r) => toRow(r, activity.get(r.id) ?? null)), meta: offsetMeta(q, total) });
});

organizations.get("/summary", "platform", async (_req, res) => {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [byStatus, users, locations, newThisMonth, trialsEnding] = await Promise.all([
    unscopedDb.tenant.groupBy({ by: ["status"], _count: { _all: true } }),
    unscopedDb.user.count({ where: { deletedAt: null, status: "ACTIVE" } }),
    unscopedDb.location.count({ where: { deletedAt: null } }),
    unscopedDb.tenant.count({ where: { createdAt: { gte: monthStart } } }),
    unscopedDb.tenant.count({ where: { status: "TRIAL", trialEndsAt: { lte: new Date(Date.now() + 7 * 86_400_000) } } }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  res.json({
    data: {
      organizations: byStatus.reduce((n, b) => n + b._count._all, 0),
      trial: count("TRIAL"), active: count("ACTIVE"), suspended: count("SUSPENDED"),
      users, locations, newThisMonth, trialsEndingSoon: trialsEnding,
    },
  });
});

organizations.post("/", "platform", async (req, res) => {
  const input = organizationCreateSchema.parse(req.body);

  const currency = await unscopedDb.currency.findUnique({ where: { code: input.currency } });
  if (!currency) throw fieldError("currency", "Unknown currency");
  if (await unscopedDb.tenant.findUnique({ where: { slug: input.slug } })) throw fieldError("slug", "This web address is already taken");
  if (await unscopedDb.user.findUnique({ where: { email: input.ownerEmail } })) throw fieldError("ownerEmail", "This email is already used by another account");

  const password = input.ownerPassword ?? generatedPassword();
  const created = await createTenant({
    name: input.name, slug: input.slug, baseCurrency: input.currency,
    owner: { name: input.ownerName, email: input.ownerEmail, password },
    status: input.status, plan: input.plan,
    trialEndsAt: input.status === "TRIAL" ? new Date(Date.now() + input.trialDays * 86_400_000) : null,
    maxLocations: input.maxLocations ?? null, maxUsers: input.maxUsers ?? null,
  });
  await recordPlatformAudit(req, {
    action: "organization.create", entityType: "Tenant", entityId: created.tenantId, tenantId: created.tenantId,
    after: { name: input.name, slug: input.slug, plan: input.plan, status: input.status, ownerEmail: input.ownerEmail },
  });
  const org = await loadOrg(created.tenantId);
  res.status(201).json({
    data: toRow(org, null),
    // Shown once. Only returned when WE generated it; a password the caller chose is never echoed back.
    ...(input.ownerPassword ? {} : { meta: { ownerEmail: input.ownerEmail, ownerPassword: password } }),
  });
});

organizations.get("/:id", "platform", async (req, res) => {
  const org = await loadOrg(req.params.id as string);
  const [activity, owners, recent] = await Promise.all([
    lastActivity([org.id]),
    unscopedDb.user.findMany({
      where: { tenantId: org.id, deletedAt: null, roles: { some: { role: { isOwner: true, deletedAt: null } } } },
      select: { id: true, name: true, email: true, status: true, lastLoginAt: true },
      orderBy: { name: "asc" },
    }),
    unscopedDb.platformAuditLog.findMany({ where: { tenantId: org.id }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 10 }),
  ]);
  res.json({ data: { ...toRow(org, activity.get(org.id) ?? null), owners, recentActions: recent } });
});

organizations.patch("/:id", "platform", async (req, res) => {
  const before = await loadOrg(req.params.id as string);
  const input = organizationUpdateSchema.parse(req.body);
  await unscopedDb.tenant.update({
    where: { id: before.id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.plan !== undefined && { plan: input.plan }),
      ...(input.maxLocations !== undefined && { maxLocations: input.maxLocations }),
      ...(input.maxUsers !== undefined && { maxUsers: input.maxUsers }),
      ...(input.trialEndsAt !== undefined && { trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null }),
    },
  });
  const after = await loadOrg(before.id);
  await recordPlatformAudit(req, { action: "organization.update", entityType: "Tenant", entityId: before.id, tenantId: before.id, before: toRow(before, null), after: toRow(after, null) });
  res.json({ data: toRow(after, null) });
});

organizations.post("/:id/status", "platform", async (req, res) => {
  const before = await loadOrg(req.params.id as string);
  const { status, reason } = organizationStatusSchema.parse(req.body);
  if (status === "SUSPENDED" && !reason) throw fieldError("reason", "Say why you are suspending this organization");
  if (status === before.status) throw conflict(`Organization is already ${status.toLowerCase()}`);

  await unscopedDb.tenant.update({
    where: { id: before.id },
    // Suspending signs everyone out and bumps authVersion; the per-request tenant check then blocks every API call.
    data: { status, suspendedReason: status === "SUSPENDED" ? reason! : null, authVersion: { increment: 1 } },
  });
  if (status === "SUSPENDED") await unscopedDb.session.updateMany({ where: { tenantId: before.id, revokedAt: null }, data: { revokedAt: new Date() } });

  await recordPlatformAudit(req, { action: `organization.${status.toLowerCase()}`, entityType: "Tenant", entityId: before.id, tenantId: before.id, before: { status: before.status }, after: { status }, reason });
  res.json({ data: toRow(await loadOrg(before.id), null) });
});

organizations.post("/:id/reset-owner-password", "platform", async (req, res) => {
  const org = await loadOrg(req.params.id as string);
  const { userId, password } = z.object({ userId: idSchema, password: passwordSchema.optional() }).parse(req.body);
  const owner = await unscopedDb.user.findFirst({
    where: { id: userId, tenantId: org.id, deletedAt: null, roles: { some: { role: { isOwner: true } } } },
  });
  if (!owner) throw notFound("Owner");

  const next = password ?? generatedPassword();
  if (next.length < 12) throw validationError("Use at least 12 characters", { password: ["Use at least 12 characters"] });
  await unscopedDb.user.update({ where: { id: owner.id }, data: { passwordHash: await hashPassword(next), pinFailedAttempts: 0, pinLockedUntil: null } });
  await unscopedDb.session.updateMany({ where: { userId: owner.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await recordPlatformAudit(req, { action: "organization.owner.password_reset", entityType: "User", entityId: owner.id, tenantId: org.id, after: { email: owner.email } });
  res.json({ data: { email: owner.email }, ...(password ? {} : { meta: { password: next } }) });
});

// ---------------------------------------------------------------- platform audit log + team
export const platformAudit = platformRouter("/api/v1/platform/audit-logs");

platformAudit.get("/", "platform", async (req, res) => {
  const q = cursorQuerySchema.extend({ tenantId: idSchema.optional() }).parse(req.query);
  const where: Prisma.PlatformAuditLogWhereInput = { ...(q.tenantId && { tenantId: q.tenantId }), ...afterCursor("occurredAt", q.cursor) };
  const rows = await unscopedDb.platformAuditLog.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: q.limit + 1 });
  const page = rows.slice(0, q.limit);

  const actorIds = [...new Set(page.map((r) => r.platformUserId).filter((x): x is string => !!x))];
  const tenantIds = [...new Set(page.map((r) => r.tenantId).filter((x): x is string => !!x))];
  const [actors, tenants] = await Promise.all([
    unscopedDb.platformUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }),
    unscopedDb.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }),
  ]);
  const actorName = new Map(actors.map((a) => [a.id, a.name]));
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));
  const last = page.at(-1);
  res.json({
    data: page.map((r) => ({ ...r, actorName: r.platformUserId ? actorName.get(r.platformUserId) ?? null : null, organizationName: r.tenantId ? tenantName.get(r.tenantId) ?? null : null })),
    meta: { nextCursor: rows.length > q.limit && last ? encodeCursor(last.occurredAt, last.id) : null },
  });
});

export const platformTeam = platformRouter("/api/v1/platform/admins");
const adminSelect = { id: true, name: true, email: true, status: true, lastLoginAt: true, createdAt: true } as const;

platformTeam.get("/", "platform", async (_req, res) => {
  res.json({ data: await unscopedDb.platformUser.findMany({ select: adminSelect, orderBy: { name: "asc" } }) });
});

platformTeam.post("/", "platform", async (req, res) => {
  const input = platformUserCreateSchema.parse(req.body);
  if (await unscopedDb.platformUser.findUnique({ where: { email: input.email } })) throw fieldError("email", "This email is already registered");
  const created = await unscopedDb.platformUser.create({
    data: { name: input.name, email: input.email, passwordHash: await hashPassword(input.password) },
    select: adminSelect,
  });
  await recordPlatformAudit(req, { action: "platform.admin.create", entityType: "PlatformUser", entityId: created.id, after: { email: created.email } });
  res.status(201).json({ data: created });
});

platformTeam.patch("/:id", "platform", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const { status } = z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }).parse(req.body);
  if (id === req.platformUser!.id) throw conflict("You cannot change your own status");
  const existing = await unscopedDb.platformUser.findUnique({ where: { id } });
  if (!existing) throw notFound("Team member");
  const updated = await unscopedDb.platformUser.update({ where: { id }, data: { status }, select: adminSelect });
  if (status === "DISABLED") await revokePlatformUserSessions(id);
  await recordPlatformAudit(req, { action: `platform.admin.${status.toLowerCase()}`, entityType: "PlatformUser", entityId: id, before: { status: existing.status }, after: { status } });
  res.json({ data: updated });
});

