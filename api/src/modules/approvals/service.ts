import { createHash } from "node:crypto";
import type { ApprovalType, LimitKind, PermissionKey } from "@restoflux/contracts";
import { verifyPassword } from "../../core/auth/passwords.js";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext } from "../../core/context/context.js";
import { db, type Tx } from "../../core/db/scoped.js";
import { AppError, approvalRequired, conflict, forbidden, notFound } from "../../core/http/errors.js";
import { notify } from "../../core/notifications/notify.js";
import { checkAmount, checkDiscount } from "../../core/rbac/policy.js";
import { loadPrincipal, type Principal } from "../../core/rbac/principal.js";

// APPROVALS: when an action is above the actor's limit, a manager must approve it.
// Two ways to get approval, recorded the same way (one audit story):
//   * inline override: the manager types their email + POS PIN on the cashier's screen (instant)
//   * inbox request  : a PENDING request appears in the managers' inbox and is decided later
// Either way the original action is RETRIED carrying the approval id. The approval is bound to a hash
// of the exact action parameters, is single-use, and expires (see docs/ARCHITECTURE.md section 7.3).

/** The domain permission an approver needs, besides approvals.decide, for each kind of approval. */
const APPROVAL_PERMISSION: Record<ApprovalType, PermissionKey> = {
  VOID: "orders.void",
  REFUND: "orders.refund",
  DISCOUNT: "orders.discount",
  STOCK_ADJUSTMENT: "inventory.adjust",
  STOCK_COUNT: "inventory.count.approve",
  TRANSFER: "inventory.transfer.approve",
  PURCHASE_ORDER: "purchasing.approve",
  CASH_OUT: "cash.manage",
};

/** Which amount limit applies to the approver, for the types that have one. */
const AMOUNT_KIND: Partial<Record<ApprovalType, LimitKind>> = {
  VOID: "void",
  REFUND: "refund",
  PURCHASE_ORDER: "purchaseOrder",
  STOCK_ADJUSTMENT: "adjustment",
};

const INBOX_TTL_MS = 24 * 60 * 60 * 1000;
const INLINE_TTL_MS = 10 * 60 * 1000;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;

/** Stable hash of the action's parameters (keys sorted), so a retry can be proven identical. */
export function hashPayload(payload: unknown): string {
  const canonical = (v: unknown): unknown =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)]))
      : Array.isArray(v)
        ? v.map(canonical)
        : v;
  return createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
}

export interface ApprovalSubject {
  type: ApprovalType;
  locationId?: string | null | undefined;
  amountMinor?: number | null | undefined;
  currencyCode?: string | null | undefined;
  /** Discount percent, for DISCOUNT approvals. */
  percent?: number | null | undefined;
}

/** Can this principal approve this? Throws FORBIDDEN with the reason when not. */
export function assertCanApprove(approver: Principal, subject: ApprovalSubject): void {
  if (!approver.permissions.has("approvals.decide")) throw forbidden("You are not allowed to approve requests");
  if (!approver.permissions.has(APPROVAL_PERMISSION[subject.type])) throw forbidden("You do not hold the permission needed to approve this");
  if (subject.locationId && !approver.allLocations && !approver.locationIds.includes(subject.locationId)) {
    throw forbidden("That branch is outside your access");
  }
  const kind = AMOUNT_KIND[subject.type];
  if (kind && subject.amountMinor != null) {
    const decision = checkAmount(approver, kind, subject.amountMinor, subject.currencyCode ?? "");
    if (!decision.allowed) throw forbidden("This is above your approval limit");
  }
  if (subject.type === "DISCOUNT" && subject.percent != null) {
    if (!checkDiscount(approver, subject.percent).allowed) throw forbidden("This discount is above your approval limit");
  }
}

export interface CreateApprovalInput extends ApprovalSubject {
  entityType: string;
  entityId?: string | null;
  payload: unknown;
  reason: string;
}

/** Ask for approval (inbox). Domain services call this when guardAction says approval is needed. */
export async function createApprovalRequest(input: CreateApprovalInput) {
  const ctx = requireContext();
  if (!ctx.userId) throw forbidden("Only users can request approvals");
  const payload = { ...(input.payload as object), ...(input.percent != null ? { percent: input.percent } : {}) };

  return db.$transaction(async (tx) => {
    const approval = await tx.approvalRequest.create({
      data: {
        tenantId: ctx.tenantId,
        locationId: input.locationId ?? null,
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        payload: payload as never,
        payloadHash: hashPayload(payload),
        amountMinor: input.amountMinor ?? null,
        currencyCode: input.currencyCode ?? null,
        reason: input.reason,
        requestedById: ctx.userId!,
        method: "INBOX",
        expiresAt: new Date(Date.now() + INBOX_TTL_MS),
      },
    });
    await recordAudit(tx, { action: "approvals.request", entityType: "ApprovalRequest", entityId: approval.id, after: approval, reason: input.reason, locationId: approval.locationId });
    await notify(tx, {
      type: "APPROVAL_PENDING",
      severity: "WARN",
      title: `Approval needed: ${input.type.toLowerCase().replace("_", " ")}`,
      body: input.reason,
      requiredPermission: "approvals.decide",
      locationId: approval.locationId,
      entityType: "ApprovalRequest",
      entityId: approval.id,
      dedupeKey: `approval:${approval.id}`,
    });
    return approval;
  });
}

/** A manager decides an inbox request. */
export async function decideApproval(approver: Principal, id: string, decision: "APPROVE" | "REJECT", note?: string) {
  const request = await db.approvalRequest.findFirst({ where: { id } });
  if (!request) throw notFound("Approval request");
  if (request.status !== "PENDING") throw conflict(`This request is already ${request.status.toLowerCase()}`);
  if (request.expiresAt < new Date()) throw conflict("This request has expired");
  if (request.requestedById === approver.userId) throw forbidden("You cannot decide your own request");

  if (decision === "APPROVE") {
    assertCanApprove(approver, {
      type: request.type as ApprovalType,
      locationId: request.locationId,
      amountMinor: request.amountMinor,
      currencyCode: request.currencyCode,
      percent: (request.payload as { percent?: number } | null)?.percent ?? null,
    });
  } else if (!approver.permissions.has("approvals.decide")) {
    throw forbidden("You are not allowed to decide requests");
  }

  return db.$transaction(async (tx) => {
    // Compare-and-set: two managers cannot both decide the same request.
    const { count } = await tx.approvalRequest.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        decidedById: approver.userId,
        decidedAt: new Date(),
        decisionNote: note ?? null,
        method: "INBOX",
      },
    });
    if (count === 0) throw conflict("This request was already decided");
    const after = await tx.approvalRequest.findFirstOrThrow({ where: { id } });
    await recordAudit(tx, {
      action: decision === "APPROVE" ? "approvals.approve" : "approvals.reject",
      entityType: "ApprovalRequest",
      entityId: id,
      before: request,
      after,
      reason: note,
      locationId: request.locationId,
    });
    await notify(tx, {
      type: "APPROVAL_DECIDED",
      severity: decision === "APPROVE" ? "INFO" : "WARN",
      title: `Your ${request.type.toLowerCase().replace("_", " ")} request was ${decision === "APPROVE" ? "approved" : "rejected"}`,
      body: note,
      userId: request.requestedById,
      locationId: request.locationId,
      entityType: "ApprovalRequest",
      entityId: id,
      dedupeKey: `approval-decided:${id}`,
    });
    return after;
  });
}

export interface PinOverrideInput extends CreateApprovalInput {
  approverEmail: string;
  pin: string;
  payloadHash: string;
}

/** Inline manager override at the point of sale: the approver's email + POS PIN. */
export async function overrideWithPin(requester: Principal, input: PinOverrideInput) {
  const invalid = () => forbidden("Invalid approver or PIN");

  const approver = await db.user.findFirst({ where: { email: input.approverEmail, status: "ACTIVE" } });
  if (!approver) throw invalid();
  if (approver.id === requester.userId) throw forbidden("You cannot approve your own request");
  if (approver.pinLockedUntil && approver.pinLockedUntil > new Date()) throw forbidden("PIN is locked, try again later");

  const pinOk = approver.posPinHash ? await verifyPassword(input.pin, approver.posPinHash) : false;
  if (!pinOk) {
    // Persisted outside any transaction so the counter survives the error we are about to throw.
    const attempts = approver.pinFailedAttempts + 1;
    await db.user.update({
      where: { id: approver.id },
      data: { pinFailedAttempts: attempts, pinLockedUntil: attempts >= PIN_MAX_ATTEMPTS ? new Date(Date.now() + PIN_LOCK_MS) : null },
    });
    throw invalid();
  }
  if (approver.pinFailedAttempts > 0) await db.user.update({ where: { id: approver.id }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });

  const approverPrincipal = await loadPrincipal(approver.id, "pin-override");
  assertCanApprove(approverPrincipal, input);

  const payload = { ...(input.payload as object), ...(input.percent != null ? { percent: input.percent } : {}) };
  return db.$transaction(async (tx) => {
    const approval = await tx.approvalRequest.create({
      data: {
        tenantId: requester.tenantId,
        locationId: input.locationId ?? null,
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        payload: payload as never,
        payloadHash: input.payloadHash,
        amountMinor: input.amountMinor ?? null,
        currencyCode: input.currencyCode ?? null,
        reason: input.reason,
        requestedById: requester.userId,
        status: "APPROVED",
        method: "INLINE_PIN",
        decidedById: approver.id,
        decidedAt: new Date(),
        expiresAt: new Date(Date.now() + INLINE_TTL_MS),
      },
    });
    await recordAudit(tx, {
      action: "approvals.override",
      entityType: "ApprovalRequest",
      entityId: approval.id,
      after: { ...approval, approverEmail: approver.email },
      reason: input.reason,
      locationId: approval.locationId,
    });
    return approval;
  });
}

export interface ConsumeInput {
  approvalId: string;
  type: ApprovalType;
  payloadHash: string;
  requesterId: string;
  amountMinor?: number | null;
}

/** Use up an approval for the action being retried. Single use; must match the action exactly. */
export async function consumeApproval(tx: Tx, input: ConsumeInput): Promise<void> {
  const approval = await tx.approvalRequest.findFirst({ where: { id: input.approvalId } });
  const reject = (why: string) => approvalRequired(`Approval is not valid: ${why}`, { approvalId: input.approvalId });

  if (!approval) throw reject("not found");
  if (approval.type !== input.type) throw reject("wrong type");
  if (approval.requestedById !== input.requesterId) throw reject("issued to someone else");
  if (approval.payloadHash !== input.payloadHash) throw reject("the action changed after it was approved");
  if (approval.status !== "APPROVED") throw reject(approval.status === "CONSUMED" ? "already used" : `status is ${approval.status.toLowerCase()}`);
  if (approval.expiresAt < new Date()) throw reject("expired");
  if (approval.amountMinor != null && input.amountMinor != null && input.amountMinor > approval.amountMinor) throw reject("amount is higher than approved");

  const { count } = await tx.approvalRequest.updateMany({ where: { id: approval.id, status: "APPROVED" }, data: { status: "CONSUMED", consumedAt: new Date() } });
  if (count === 0) throw reject("already used");
  await recordAudit(tx, {
    action: "approvals.consume",
    entityType: "ApprovalRequest",
    entityId: approval.id,
    before: { status: "APPROVED" },
    after: { status: "CONSUMED" },
    locationId: approval.locationId,
  });
}

export interface GuardInput extends CreateApprovalInput {
  payloadHash: string;
  /** Approval id sent by the client when retrying after approval. */
  approvalId?: string | null | undefined;
}

/**
 * The one call domain services make before a limited action:
 *   within the actor's own limit  -> returns { approvalId: null }
 *   otherwise, with a valid approvalId -> consumes it and returns it
 *   otherwise -> throws APPROVAL_REQUIRED (403) telling the client how to get approval
 */
export async function guardAction(tx: Tx, actor: Principal, input: GuardInput): Promise<{ approvalId: string | null }> {
  const kind = AMOUNT_KIND[input.type];
  let decision: { allowed: boolean; reason?: string } = { allowed: true };
  if (kind && input.amountMinor != null) decision = checkAmount(actor, kind, input.amountMinor, input.currencyCode ?? "");
  else if (input.type === "DISCOUNT" && input.percent != null) decision = checkDiscount(actor, input.percent);
  if (decision.allowed) return { approvalId: null };

  if (input.approvalId) {
    await consumeApproval(tx, {
      approvalId: input.approvalId,
      type: input.type,
      payloadHash: input.payloadHash,
      requesterId: actor.userId,
      amountMinor: input.amountMinor,
    });
    return { approvalId: input.approvalId };
  }
  throw new AppError(403, "APPROVAL_REQUIRED", "A manager's approval is required", {
    type: input.type,
    reason: decision.reason,
    amountMinor: input.amountMinor ?? null,
    currencyCode: input.currencyCode ?? null,
    options: ["INLINE_PIN", "INBOX"],
  });
}
