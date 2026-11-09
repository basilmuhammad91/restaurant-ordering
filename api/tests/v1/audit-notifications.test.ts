import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { runAsTenant } from "../../src/core/context/context.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { db } from "../../src/core/db/scoped.js";
import { notify } from "../../src/core/notifications/notify.js";
import { createFixture, createStaff, loginOwner, loginStaff, type Fixture } from "../helpers/fixtures.js";
import { api } from "../helpers/http.js";

const app = createApp();
let fx: Fixture;
let owner: ReturnType<typeof api>;

beforeAll(async () => {
  fx = await createFixture();
  owner = api(app, (await loginOwner(app, fx)).token);
});
afterAll(async () => {
  await fx.cleanup();
  await unscopedDb.$disconnect();
});

describe("audit log viewer", () => {
  const ids: string[] = [];

  beforeAll(async () => {
    for (let i = 1; i <= 7; i++) ids.push((await owner.post("/brands", { name: `Audit brand ${i}`, slug: `audit-brand-${i}` })).body.data.id);
    await owner.patch(`/brands/${ids[0]}`, { name: "Audit brand 1 renamed" });
    await owner.post("/tax-categories", { name: "Audit cat" });
  });

  it("is newest-first and paginates with a cursor without gaps or duplicates", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await owner.get(`/audit-logs?limit=4${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((r: any) => r.id));
      cursor = res.body.meta.nextCursor;
      if (++pages > 20) throw new Error("cursor pagination did not terminate");
    } while (cursor);

    expect(new Set(seen).size).toBe(seen.length); // no duplicates
    const total = await unscopedDb.auditLog.count({ where: { tenantId: fx.tenantId } });
    expect(seen.length).toBe(total); // no gaps

    const all = (await owner.get("/audit-logs?limit=100")).body.data;
    const times = all.map((r: any) => new Date(r.occurredAt).getTime());
    expect(times).toEqual([...times].sort((a: number, b: number) => b - a));
  });

  it("filters by action, action prefix, entity, actor and date range", async () => {
    const created = await owner.get("/audit-logs?action=brands.create&limit=100");
    expect(created.body.data.length).toBeGreaterThanOrEqual(7);
    expect(created.body.data.every((r: any) => r.action === "brands.create")).toBe(true);

    const prefix = await owner.get("/audit-logs?actionPrefix=brands.&limit=100");
    expect(prefix.body.data.every((r: any) => r.action.startsWith("brands."))).toBe(true);
    expect(prefix.body.data.some((r: any) => r.action === "brands.update")).toBe(true);

    const entity = await owner.get(`/audit-logs?entityType=Brand&entityId=${ids[0]}`);
    expect(entity.body.data.map((r: any) => r.action).sort()).toEqual(["brands.create", "brands.update"]);

    const byActor = await owner.get(`/audit-logs?actorUserId=${fx.ownerUserId}&limit=100`);
    expect(byActor.body.data.length).toBeGreaterThan(0);
    expect(byActor.body.data.every((r: any) => r.actor.email === fx.ownerEmail)).toBe(true);

    const future = await owner.get(`/audit-logs?from=${new Date(Date.now() + 3_600_000).toISOString()}`);
    expect(future.body.data).toHaveLength(0);
    const window = await owner.get(`/audit-logs?from=${new Date(Date.now() - 3_600_000).toISOString()}&to=${new Date(Date.now() + 3_600_000).toISOString()}&limit=100`);
    expect(window.body.data.length).toBeGreaterThan(0);
  });

  it("shows before/after values and who did it", async () => {
    const row = (await owner.get(`/audit-logs?action=brands.update&entityId=${ids[0]}`)).body.data[0];
    expect(row.before.name).toBe("Audit brand 1");
    expect(row.after.name).toBe("Audit brand 1 renamed");
    expect(row.actor).toMatchObject({ id: fx.ownerUserId, name: "Test Owner" });
    expect(row.requestId).toEqual(expect.any(String));
  });

  it("rejects bad cursors and bad filters", async () => {
    expect((await owner.get("/audit-logs?cursor=garbage")).status).toBe(422);
    expect((await owner.get("/audit-logs?actorUserId=not-a-uuid")).status).toBe(422);
    expect((await owner.get("/audit-logs?limit=1000")).status).toBe(422);
  });

  it("requires audit.view", async () => {
    const nobody = api(app, (await loginStaff(app, await createStaff(fx, { permissions: ["org.view"] }))).token);
    expect((await nobody.get("/audit-logs")).status).toBe(403);
  });

  it("is append-only at the database level: rows cannot be edited or deleted", async () => {
    const row = await unscopedDb.auditLog.findFirstOrThrow({ where: { tenantId: fx.tenantId } });
    await expect(unscopedDb.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(unscopedDb.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(unscopedDb.auditLog.deleteMany({ where: { tenantId: fx.tenantId } })).rejects.toThrow(/append-only/);
    await expect(unscopedDb.loginEvent.deleteMany({ where: { tenantId: fx.tenantId } })).rejects.toThrow(/append-only/);
    expect((await unscopedDb.auditLog.findUnique({ where: { id: row.id } }))?.action).not.toBe("tampered");
  });

  it("a change and its audit record commit together: a failing transaction leaves neither", async () => {
    const before = await unscopedDb.auditLog.count({ where: { tenantId: fx.tenantId } });
    // duplicate slug: the brand insert fails, so its audit record must not exist either
    const dup = await owner.post("/brands", { name: "Dup attempt", slug: "audit-brand-1" });
    expect(dup.status).toBe(409);
    expect(await unscopedDb.auditLog.count({ where: { tenantId: fx.tenantId } })).toBe(before);
  });
});

describe("notifications", () => {
  let manager: ReturnType<typeof api>;
  let managerId: string;
  let cashier: ReturnType<typeof api>;
  let cashierId: string;

  beforeAll(async () => {
    const m = await createStaff(fx, { permissions: ["approvals.view", "approvals.decide"] });
    const c = await createStaff(fx, { roleName: "Cashier" });
    managerId = m.id;
    cashierId = c.id;
    manager = api(app, (await loginStaff(app, m)).token);
    cashier = api(app, (await loginStaff(app, c)).token);

    await runAsTenant(fx.tenantId, async () => {
      await notify(db, { type: "APPROVAL_PENDING", severity: "WARN", title: "For approvers", requiredPermission: "approvals.decide", dedupeKey: "n-approvers" });
      await notify(db, { type: "NOTE", title: "For the cashier only", userId: cashierId, dedupeKey: "n-cashier" });
      await notify(db, { type: "NOTE", title: "For the manager only", userId: managerId, dedupeKey: "n-manager" });
      await notify(db, { type: "ANNOUNCEMENT", title: "For everyone", dedupeKey: "n-everyone" });
      await notify(db, { type: "NOTE", title: "Needs reports permission", requiredPermission: "reports.sales.view", dedupeKey: "n-reports" });
    });
  });

  it("delivers to the named user, to holders of the permission, or to everyone, and to nobody else", async () => {
    const m = (await manager.get("/notifications?limit=100")).body.data.map((n: any) => n.title);
    expect(m).toEqual(expect.arrayContaining(["For approvers", "For the manager only", "For everyone"]));
    expect(m).not.toContain("For the cashier only");
    expect(m).not.toContain("Needs reports permission");

    const c = (await cashier.get("/notifications?limit=100")).body.data.map((n: any) => n.title);
    expect(c).toEqual(expect.arrayContaining(["For the cashier only", "For everyone"]));
    expect(c).not.toContain("For approvers");
    expect(c).not.toContain("For the manager only");
  });

  it("does not create duplicates for the same dedupe key (no alert storms)", async () => {
    await runAsTenant(fx.tenantId, async () => {
      for (let i = 0; i < 3; i++) await notify(db, { type: "LOW_STOCK", title: "Low stock: flour", requiredPermission: "approvals.view", dedupeKey: "low-stock-flour" });
    });
    expect(await unscopedDb.notification.count({ where: { tenantId: fx.tenantId, dedupeKey: "low-stock-flour" } })).toBe(1);
  });

  it("counts unread, marks one read, then marks all read", async () => {
    const first = await manager.get("/notifications?limit=100");
    const unread = first.body.meta.unreadCount as number;
    expect(unread).toBeGreaterThanOrEqual(3);

    const target = first.body.data.find((n: any) => n.title === "For the manager only");
    expect((await manager.post(`/notifications/${target.id}/read`)).status).toBe(204);
    expect((await manager.get("/notifications?limit=100")).body.meta.unreadCount).toBe(unread - 1);
    expect((await manager.get("/notifications?unread=true&limit=100")).body.data.map((n: any) => n.id)).not.toContain(target.id);

    const all = await manager.post("/notifications/read-all");
    expect(all.body.data.updated).toBe(unread - 1);
    expect((await manager.get("/notifications?limit=100")).body.meta.unreadCount).toBe(0);
  });

  it("cannot mark someone else's notification as read", async () => {
    const mine = (await cashier.get("/notifications?limit=100")).body.data.find((n: any) => n.title === "For the cashier only");
    const row = await unscopedDb.notification.findFirstOrThrow({ where: { tenantId: fx.tenantId, dedupeKey: "n-manager" } });
    expect((await cashier.post(`/notifications/${row.id}/read`)).status).toBe(404);
    expect(mine).toBeTruthy();
  });

  it("paginates with a cursor", async () => {
    const p1 = await manager.get("/notifications?limit=2");
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.meta.nextCursor).toEqual(expect.any(String));
    const p2 = await manager.get(`/notifications?limit=2&cursor=${p1.body.meta.nextCursor}`);
    expect(p2.body.data.every((n: any) => !p1.body.data.some((x: any) => x.id === n.id))).toBe(true);
  });
});
