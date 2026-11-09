import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { contextFromPrincipal } from "../../src/core/auth/context.js";
import { runWithContext } from "../../src/core/context/context.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { db } from "../../src/core/db/scoped.js";
import { loadPrincipal, type Principal } from "../../src/core/rbac/principal.js";
import { createApprovalRequest, guardAction, hashPayload, type GuardInput } from "../../src/modules/approvals/service.js";
import { createBaseOrg, createFixture, createLocation, createStaff, loginStaff, type BaseOrg, type Fixture, type Staff } from "../helpers/fixtures.js";
import { api, auditFor } from "../helpers/http.js";

// Default role limits in PKR minor units (paisa): Branch Manager void 1,000,000 / discount 20%;
// Area Manager void 5,000,000 / discount 25%; Cashier has no limits at all; Head Office Admin is unlimited.

const app = createApp();
let fx: Fixture;
let base: BaseOrg;
let L1: string;
let L2: string;
let cashier: Staff;
let cashier2: Staff;
let manager: Staff; // Branch Manager at L1, PIN 4821
let area: Staff; // Area Manager at L1+L2, PIN 9137
let admin: Staff; // Head Office Admin (unlimited)
let asManager: ReturnType<typeof api>;
let asArea: ReturnType<typeof api>;
let asCashier: ReturnType<typeof api>;
let asAdmin: ReturnType<typeof api>;

/** Run service code as a user: loads their principal and opens the request context, like authenticate does. */
async function asUser<T>(staff: Staff, fn: (p: Principal) => Promise<T>): Promise<T> {
  const principal = await loadPrincipal(staff.id, "test-session");
  return runWithContext(contextFromPrincipal(principal, { requestId: "approvals-test" }), () => fn(principal));
}

let seq = 0;
const voidInput = (over: Partial<GuardInput> = {}): GuardInput => {
  const payload = { orderId: `order-${++seq}`, lineId: "line-1" };
  return {
    type: "VOID", entityType: "Order", entityId: payload.orderId, locationId: L1, amountMinor: 500_000, currencyCode: "PKR",
    payload, payloadHash: hashPayload(payload), reason: "Customer left before eating", ...over,
  };
};
const guard = (staff: Staff, input: GuardInput) => asUser(staff, (p) => db.$transaction((tx) => guardAction(tx, p, input)));
const request = (staff: Staff, input: GuardInput) => asUser(staff, () => createApprovalRequest(input));
const approve = (as: ReturnType<typeof api>, id: string, decision = "APPROVE") => as.post(`/approvals/${id}/decision`, { decision, note: "ok" });

beforeAll(async () => {
  fx = await createFixture();
  base = await createBaseOrg(fx);
  L1 = (await createLocation(fx, base, "AP-1")).id;
  L2 = (await createLocation(fx, base, "AP-2")).id;
  cashier = await createStaff(fx, { roleName: "Cashier", locationIds: [L1] });
  cashier2 = await createStaff(fx, { roleName: "Cashier", locationIds: [L1] });
  manager = await createStaff(fx, { roleName: "Branch Manager", locationIds: [L1], pin: "4821" });
  area = await createStaff(fx, { roleName: "Area Manager", locationIds: [L1, L2], pin: "9137" });
  admin = await createStaff(fx, { roleName: "Head Office Admin", allLocations: true });
  asManager = api(app, (await loginStaff(app, manager)).token);
  asArea = api(app, (await loginStaff(app, area)).token);
  asCashier = api(app, (await loginStaff(app, cashier)).token);
  asAdmin = api(app, (await loginStaff(app, admin)).token);
});
afterAll(async () => {
  await fx.cleanup();
  await unscopedDb.$disconnect();
});

describe("guardAction: does this need a manager?", () => {
  it("lets a manager act within their own limit without any approval", async () => {
    expect(await guard(manager, voidInput({ amountMinor: 1_000_000 }))).toEqual({ approvalId: null }); // exactly at the limit
    expect(await guard(manager, voidInput({ amountMinor: 1 }))).toEqual({ approvalId: null });
  });

  it("lets an unlimited role (Head Office Admin) act on any amount", async () => {
    expect(await guard(admin, voidInput({ amountMinor: 1_900_000_000 }))).toEqual({ approvalId: null });
  });

  it("requires approval one paisa above the limit, and tells the client how to get it", async () => {
    await expect(guard(manager, voidInput({ amountMinor: 1_000_001 }))).rejects.toMatchObject({
      status: 403, code: "APPROVAL_REQUIRED", details: { type: "VOID", options: ["INLINE_PIN", "INBOX"] },
    });
  });

  it("a cashier (no limits) needs approval for every amount", async () => {
    await expect(guard(cashier, voidInput({ amountMinor: 1 }))).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  });

  it("limits are per currency: a PKR limit gives no authority in a currency without a limit row", async () => {
    await expect(guard(manager, voidInput({ amountMinor: 100, currencyCode: "SAR" }))).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  });
});

describe("inbox approval, end to end", () => {
  it("request -> notification -> manager approves -> requester retries once -> single use", async () => {
    const input = voidInput({ amountMinor: 800_000 });
    const req = await request(cashier, input);
    expect(req.status).toBe("PENDING");

    // the manager sees it, and was notified
    const pending = await asManager.get("/approvals?status=PENDING");
    expect(pending.body.data.map((a: any) => a.id)).toContain(req.id);
    expect(pending.body.data.find((a: any) => a.id === req.id).requestedBy.id).toBe(cashier.id);
    const notes = await asManager.get("/notifications?limit=50");
    expect(notes.body.data.some((n: any) => n.type === "APPROVAL_PENDING" && n.entityId === req.id)).toBe(true);

    const decided = await approve(asManager, req.id);
    expect(decided.status).toBe(200);
    expect(decided.body.data).toMatchObject({ status: "APPROVED", decidedById: manager.id, method: "INBOX" });

    // the requester was told
    expect((await asCashier.get("/notifications?limit=50")).body.data.some((n: any) => n.type === "APPROVAL_DECIDED" && n.entityId === req.id)).toBe(true);

    // the cashier retries the SAME action with the approval id
    expect(await guard(cashier, { ...input, approvalId: req.id })).toEqual({ approvalId: req.id });
    expect((await unscopedDb.approvalRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("CONSUMED");

    // and cannot use it twice
    await expect(guard(cashier, { ...input, approvalId: req.id })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED", message: expect.stringMatching(/already used/) });
  });

  it("is bound to the exact action: a different payload, a different user or a bigger amount is refused", async () => {
    const input = voidInput({ amountMinor: 900_000 });
    const req = await request(cashier, input);
    await approve(asManager, req.id);

    const otherPayload = { orderId: "a-different-order", lineId: "line-9" };
    await expect(guard(cashier, { ...input, payload: otherPayload, payloadHash: hashPayload(otherPayload), approvalId: req.id })).rejects.toMatchObject({ message: expect.stringMatching(/action changed/) });
    await expect(guard(cashier2, { ...input, approvalId: req.id })).rejects.toMatchObject({ message: expect.stringMatching(/issued to someone else/) });
    await expect(guard(cashier, { ...input, amountMinor: 950_000, approvalId: req.id })).rejects.toMatchObject({ message: expect.stringMatching(/higher than approved/) });
    await expect(guard(cashier, { ...input, type: "REFUND", approvalId: req.id })).rejects.toMatchObject({ message: expect.stringMatching(/wrong type/) });
    // none of the failed attempts used it up
    expect(await guard(cashier, { ...input, approvalId: req.id })).toEqual({ approvalId: req.id });
  });

  it("expired approvals are refused, and expired requests cannot be decided", async () => {
    const input = voidInput({ amountMinor: 700_000 });
    const req = await request(cashier, input);
    await approve(asManager, req.id);
    await unscopedDb.approvalRequest.update({ where: { id: req.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(guard(cashier, { ...input, approvalId: req.id })).rejects.toMatchObject({ message: expect.stringMatching(/expired/) });

    const stale = await request(cashier, voidInput({ amountMinor: 700_000 }));
    await unscopedDb.approvalRequest.update({ where: { id: stale.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await approve(asManager, stale.id)).status).toBe(409);
  });

  it("rejections are final and cannot be consumed", async () => {
    const input = voidInput({ amountMinor: 600_000 });
    const req = await request(cashier, input);
    const rej = await approve(asManager, req.id, "REJECT");
    expect(rej.body.data.status).toBe("REJECTED");
    await expect(guard(cashier, { ...input, approvalId: req.id })).rejects.toMatchObject({ message: expect.stringMatching(/rejected/) });
    expect((await approve(asManager, req.id)).status).toBe(409); // already decided
  });

  it("two managers cannot both decide the same request", async () => {
    const req = await request(cashier, voidInput({ amountMinor: 500_000 }));
    const [a, b] = await Promise.all([approve(asManager, req.id), approve(asArea, req.id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});

describe("who may approve what", () => {
  it("the approver's own limit applies: branch manager cannot approve above their limit, area manager and admin can", async () => {
    const req = await request(cashier, voidInput({ amountMinor: 3_000_000 })); // above BM (1,000,000), within AM (5,000,000)
    const byManager = await approve(asManager, req.id);
    expect(byManager.status).toBe(403);
    expect(byManager.body.error.message).toMatch(/above your approval limit/);
    expect((await approve(asArea, req.id)).status).toBe(200);

    const huge = await request(cashier, voidInput({ amountMinor: 900_000_000 }));
    expect((await approve(asArea, huge.id)).status).toBe(403);
    expect((await approve(asAdmin, huge.id)).status).toBe(200);
  });

  it("you cannot approve your own request, and cashiers cannot approve anything", async () => {
    const own = await request(manager, voidInput({ amountMinor: 2_000_000 })); // manager asks for something above their limit
    expect((await approve(asManager, own.id)).status).toBe(403);
    expect((await approve(asArea, own.id)).status).toBe(200);

    const other = await request(cashier2, voidInput({ amountMinor: 100 }));
    const res = await approve(asCashier, other.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("branch scope applies: a manager cannot see or decide requests for another branch", async () => {
    const req = await request(area, voidInput({ locationId: L2, amountMinor: 6_000_000 })); // area manager's own over-limit ask at L2
    expect((await asManager.get(`/approvals/${req.id}`)).status).toBe(404); // manager only has L1
    expect((await approve(asManager, req.id)).status).toBe(404);
    expect((await approve(asAdmin, req.id)).status).toBe(200);
  });

  it("discount approvals compare percentages with the approver's maximum discount", async () => {
    const mk = (percent: number) => voidInput({ type: "DISCOUNT", amountMinor: undefined as never, percent });
    await expect(guard(cashier, mk(15))).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" }); // cashier max 10%
    expect(await guard(cashier, mk(10))).toEqual({ approvalId: null });
    expect(await guard(manager, mk(20))).toEqual({ approvalId: null });

    const fifteen = await request(cashier, mk(15));
    expect((await approve(asManager, fifteen.id)).status).toBe(200); // manager max 20%
    const twentyFive = await request(cashier, mk(24));
    expect((await approve(asManager, twentyFive.id)).status).toBe(403);
    expect((await approve(asArea, twentyFive.id)).status).toBe(200); // area manager max 25%
  });

  it("only approvals the approver's domain permission covers: a role without orders.void cannot approve voids", async () => {
    const onlyDecide = await createStaff(fx, { permissions: ["approvals.view", "approvals.decide"], locationIds: [L1], limits: { PKR: { void: 99_999_999 } } });
    const as = api(app, (await loginStaff(app, onlyDecide)).token);
    const req = await request(cashier, voidInput({ amountMinor: 100 }));
    const res = await as.post(`/approvals/${req.id}/decision`, { decision: "APPROVE" });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/permission needed/);
  });
});

describe("inline manager override with POS PIN", () => {
  const override = (as: ReturnType<typeof api>, body: object) => as.post("/approvals/override", body);
  const base = (input: GuardInput, over: object = {}) => ({
    type: input.type, approverEmail: manager.email, pin: "4821", locationId: L1, entityType: input.entityType, entityId: input.entityId,
    payloadHash: input.payloadHash, amountMinor: input.amountMinor, currencyCode: "PKR", reason: "Customer is upset", ...over,
  });

  it("a correct PIN gives an instant, single-use, audited approval", async () => {
    const input = voidInput({ amountMinor: 900_000 });
    const res = await override(asCashier, base(input));
    expect(res.status).toBe(201);
    const approvalId = res.body.data.approvalId as string;

    const row = await unscopedDb.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } });
    expect(row).toMatchObject({ status: "APPROVED", method: "INLINE_PIN", requestedById: cashier.id, decidedById: manager.id });
    expect(await guard(cashier, { ...input, approvalId })).toEqual({ approvalId });
    await expect(guard(cashier, { ...input, approvalId })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });

    const actions = (await auditFor(fx.tenantId, "ApprovalRequest", approvalId)).map((r) => r.action);
    expect(actions).toEqual(["approvals.override", "approvals.consume"]);
    expect(JSON.stringify(await auditFor(fx.tenantId, "ApprovalRequest", approvalId))).not.toMatch(/4821|posPinHash/);
  });

  it("refuses wrong PINs, unknown approvers, self-approval, approvers without the right, and branches outside their access", async () => {
    const input = voidInput({ amountMinor: 800_000 });
    const wrong = await override(asCashier, base(input, { pin: "0000" }));
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.message).toBe("Invalid approver or PIN");
    expect((await override(asCashier, base(input, { approverEmail: `ghost@${fx.slug}.test` }))).body.error.message).toBe("Invalid approver or PIN"); // same message: no user enumeration
    expect((await override(asManager, base(input))).status).toBe(403); // approving your own request
    expect((await override(asCashier, base(input, { approverEmail: cashier2.email, pin: "1234" }))).status).toBe(403); // cashier2 has no PIN / no authority
    expect((await override(asCashier, base(input, { locationId: L2 }))).status).toBe(403); // manager has no access to L2
    expect((await override(asCashier, base(input, { amountMinor: 2_000_000 }))).status).toBe(403); // above the manager's limit
    expect((await override(asCashier, base(input, { pin: "12" }))).status).toBe(422); // malformed PIN
    expect((await override(asCashier, base(input, { approverEmail: area.email, pin: "9137", amountMinor: 2_000_000 }))).status).toBe(201); // the area manager can
  });

  it("locks the PIN after 5 failures, even for the right PIN, and resets on success", async () => {
    const input = voidInput({ amountMinor: 100_000 });
    for (let i = 0; i < 5; i++) expect((await override(asCashier, base(input, { pin: "1111" }))).status).toBe(403);
    expect((await unscopedDb.user.findUniqueOrThrow({ where: { id: manager.id } })).pinFailedAttempts).toBe(5);

    const locked = await override(asCashier, base(input));
    expect(locked.status).toBe(403);
    expect(locked.body.error.message).toMatch(/locked/i);

    // lock expires (simulate): the right PIN works again and the counter resets
    await unscopedDb.user.update({ where: { id: manager.id }, data: { pinLockedUntil: new Date(Date.now() - 1000) } });
    expect((await override(asCashier, base(input))).status).toBe(201);
    expect((await unscopedDb.user.findUniqueOrThrow({ where: { id: manager.id } })).pinFailedAttempts).toBe(0);
  });
});

describe("the approval trail", () => {
  it("audits request, decision and consumption with who did what", async () => {
    const input = voidInput({ amountMinor: 450_000 });
    const req = await request(cashier, input);
    await approve(asManager, req.id);
    await guard(cashier, { ...input, approvalId: req.id });
    const rows = await auditFor(fx.tenantId, "ApprovalRequest", req.id);
    expect(rows.map((r) => r.action)).toEqual(["approvals.request", "approvals.approve", "approvals.consume"]);
    expect(rows.map((r) => r.actorUserId)).toEqual([cashier.id, manager.id, cashier.id]);
    expect(rows.every((r) => r.locationId === L1)).toBe(true);
  });

  it("lists with filters and pagination", async () => {
    const approved = await asManager.get("/approvals?status=CONSUMED&type=VOID&pageSize=2");
    expect(approved.status).toBe(200);
    expect(approved.body.data.every((a: any) => a.status === "CONSUMED" && a.type === "VOID")).toBe(true);
    expect(approved.body.meta).toMatchObject({ page: 1, pageSize: 2 });
    expect((await asManager.get("/approvals?status=NOT_A_STATUS")).status).toBe(422);
  });
});
