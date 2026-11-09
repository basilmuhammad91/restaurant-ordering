import { approvalDecisionInputSchema, approvalOverrideInputSchema, APPROVAL_STATUSES, APPROVAL_TYPES, idSchema, listQuerySchema } from "@restoflux/contracts";
import { z } from "zod";
import { db } from "../../core/db/scoped.js";
import { notFound } from "../../core/http/errors.js";
import { offsetMeta, paging } from "../../core/http/pagination.js";
import { rateLimit } from "../../core/http/rateLimit.js";
import { securedRouter } from "../../core/http/secured.js";
import { decideApproval, overrideWithPin } from "./service.js";

// APPROVALS inbox and inline manager override. Requests are CREATED by domain services (voids, refunds,
// purchase orders ...) through guardAction(); here managers list, inspect and decide them.

const { router, get, post } = securedRouter("/api/v1/approvals");
const idParams = z.object({ id: idSchema });

const include = {
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} as const;

get("/", "approvals.view", async (req, res) => {
  const q = listQuerySchema
    .extend({
      status: z.enum(APPROVAL_STATUSES).optional(),
      type: z.enum(APPROVAL_TYPES).optional(),
      locationId: idSchema.optional(),
    })
    .parse(req.query);
  const where = { ...(q.status && { status: q.status }), ...(q.type && { type: q.type }), ...(q.locationId && { locationId: q.locationId }) };
  const [rows, total] = await Promise.all([
    db.approvalRequest.findMany({ where, include, orderBy: { createdAt: "desc" }, ...paging(q) }),
    db.approvalRequest.count({ where }),
  ]);
  res.json({ data: rows, meta: offsetMeta(q, total) });
});

get("/:id", "approvals.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const row = await db.approvalRequest.findFirst({ where: { id }, include });
  if (!row) throw notFound("approval request");
  res.json({ data: row });
});

post("/:id/decision", "approvals.decide", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { decision, note } = approvalDecisionInputSchema.parse(req.body);
  res.json({ data: await decideApproval(req.principal!, id, decision, note) });
});

// Inline override: a manager types their email and POS PIN on the requester's screen. Rate limited
// (and the PIN locks after repeated failures) because it is a PIN guessing target.
post(
  "/override",
  "authenticated",
  rateLimit({ name: "override", max: 20, windowMs: 60_000, key: (req) => req.principal?.userId ?? req.ip ?? "anon" }),
  async (req, res) => {
    const input = approvalOverrideInputSchema.parse(req.body);
    const approval = await overrideWithPin(req.principal!, { ...input, payload: {} });
    res.status(201).json({ data: { approvalId: approval.id, expiresAt: approval.expiresAt } });
  },
);

export const approvalsRouter = router;
