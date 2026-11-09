import { changePasswordInputSchema, loginInputSchema, themeSchema, type MeResponse, type PermissionKey } from "@restoflux/contracts";
import type { Request } from "express";
import { contextFromPrincipal } from "../../core/auth/context.js";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../../core/auth/passwords.js";
import { clearRefreshCookie, createSession, readRefreshCookie, revokeSession, rotateSession, setRefreshCookie } from "../../core/auth/sessions.js";
import { hashRefreshToken, signAccessToken } from "../../core/auth/tokens.js";
import { recordAudit } from "../../core/audit/audit.js";
import { env } from "../../core/config/env.js";
import { runWithContext } from "../../core/context/context.js";
import { unscopedDb } from "../../core/db/client.js";
import { db } from "../../core/db/scoped.js";
import { fieldError, unauthenticated } from "../../core/http/errors.js";
import { rateLimit } from "../../core/http/rateLimit.js";
import { securedRouter } from "../../core/http/secured.js";
import { loadPrincipal, type Principal } from "../../core/rbac/principal.js";

// AUTH for staff: login, refresh (rotating), logout, who-am-I, change password.
// The access token (15 min) goes in the response body and lives in the SPA's memory; the refresh
// token lives in an httpOnly cookie. (Laravel: like Sanctum SPA auth, with token rotation added.)

export const authRoutes = securedRouter("/api/v1/auth");
const { router, get, post } = authRoutes;

const FAIL_MESSAGE = "Invalid email or password";

/** The shape the admin UI uses for permission-aware navigation. Must run inside the request context. */
async function buildMe(p: Principal): Promise<MeResponse> {
  const [user, tenant, locations] = await Promise.all([
    db.user.findFirstOrThrow({ where: { id: p.userId }, select: { id: true, name: true, email: true, phone: true, locale: true } }),
    db.tenant.findFirstOrThrow({ where: { id: p.tenantId }, select: { id: true, name: true, slug: true, baseCurrency: true, status: true, plan: true, theme: true } }),
    db.location.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, type: true, brandId: true, currencyCode: true, timezone: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    user,
    tenant: { ...tenant, theme: themeSchema.catch({}).parse(tenant.theme ?? {}) },
    roles: p.roleIds.map((id, i) => ({ id, name: p.roleNames[i] ?? "" })),
    permissions: [...p.permissions] as PermissionKey[],
    allLocations: p.allLocations,
    locations,
    maxDiscountPercent: p.maxDiscountPercent,
    unlimitedLimits: p.unlimitedLimits,
    limits: p.limits,
  };
}

const clientMeta = (req: Request) => ({ ip: req.ip, userAgent: req.get("user-agent") });

post(
  "/login",
  "public",
  rateLimit({ name: "login", max: 20, windowMs: 60_000, key: (req) => `${req.ip}:${String((req.body as { email?: unknown })?.email ?? "").toLowerCase()}` }),
  async (req, res) => {
    const { email, password } = loginInputSchema.parse(req.body);
    const meta = clientMeta(req);

    const user = await unscopedDb.user.findUnique({ where: { email }, include: { tenant: { select: { status: true } } } });
    // Always run a bcrypt compare, even for unknown emails, so timing does not reveal which emails exist.
    const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    const usable = !!user && passwordOk && user.status === "ACTIVE" && !user.deletedAt && user.tenant.status !== "SUSPENDED";

    if (!usable) {
      await unscopedDb.loginEvent.create({
        data: {
          tenantId: user?.tenantId ?? null,
          userId: user?.id ?? null,
          emailAttempted: email,
          success: false,
          failureReason: !user ? "unknown_email" : !passwordOk ? "wrong_password" : "account_not_active",
          ip: meta.ip ?? null,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
        },
      });
      throw unauthenticated(FAIL_MESSAGE);
    }

    const { session, refreshToken } = await createSession({ userId: user.id, tenantId: user.tenantId, ...meta });
    await unscopedDb.$transaction([
      unscopedDb.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      unscopedDb.loginEvent.create({ data: { tenantId: user.tenantId, userId: user.id, emailAttempted: email, success: true, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null } }),
    ]);

    const principal = await loadPrincipal(user.id, session.id);
    const me = await runWithContext(contextFromPrincipal(principal, { requestId: req.requestId, ...meta }), () => buildMe(principal));

    setRefreshCookie(res, refreshToken);
    res.json({
      data: {
        accessToken: signAccessToken({ userId: user.id, tenantId: user.tenantId, sessionId: session.id }),
        expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
        me,
      },
    });
  },
);

post("/refresh", "public", rateLimit({ name: "refresh", max: 60, windowMs: 60_000 }), async (req, res) => {
  const cookie = readRefreshCookie(req.headers.cookie);
  if (!cookie) throw unauthenticated("No refresh token");
  const { session, refreshToken } = await rotateSession(cookie, clientMeta(req));
  setRefreshCookie(res, refreshToken);
  res.json({ data: { accessToken: signAccessToken({ userId: session.userId, tenantId: session.tenantId, sessionId: session.id }), expiresIn: env.ACCESS_TOKEN_TTL_SECONDS } });
});

// Logout always succeeds and clears the cookie, whether or not the session was still valid.
post("/logout", "public", async (req, res) => {
  const cookie = readRefreshCookie(req.headers.cookie);
  if (cookie) {
    const session = await unscopedDb.session.findUnique({ where: { refreshTokenHash: hashRefreshToken(cookie) } });
    if (session) await revokeSession(session.id);
  }
  clearRefreshCookie(res);
  res.status(204).end();
});

get("/me", "authenticated", async (req, res) => {
  res.json({ data: await buildMe(req.principal!) });
});

post("/change-password", "authenticated", async (req, res) => {
  const principal = req.principal!;
  const { currentPassword, newPassword } = changePasswordInputSchema.parse(req.body);

  await db.$transaction(async (tx) => {
    const user = await tx.user.findFirstOrThrow({ where: { id: principal.userId } });
    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw fieldError("currentPassword", "Current password is incorrect");
    const strong = principal.isOwner || principal.permissions.has("dashboard.financial.view") || principal.permissions.has("reports.financial.view");
    if (strong && newPassword.length < 12) throw fieldError("newPassword", "Roles with financial access need a password of at least 12 characters");
    await tx.user.update({ where: { id: principal.userId }, data: { passwordHash: await hashPassword(newPassword) } });
    await recordAudit(tx, { action: "auth.password.change", entityType: "User", entityId: principal.userId, after: { passwordChanged: true } });
  });

  // Sign out every OTHER session (a stolen session must not survive a password change); keep this one.
  await unscopedDb.session.updateMany({ where: { userId: principal.userId, revokedAt: null, id: { not: principal.sessionId } }, data: { revokedAt: new Date() } });
  res.status(204).end();
});

export const authRouter = router;
