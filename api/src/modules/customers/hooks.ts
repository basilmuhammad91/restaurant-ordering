import type { Tx } from "../../core/db/scoped.js";
import { requireContext } from "../../core/context/context.js";
import { normalizePhone } from "./offers.js";

/**
 * Everything that follows a COMPLETED order, in the same transaction as the status change:
 *  1. coupons used on it are counted,
 *  2. the customer is remembered (matched by phone number; created on first sight),
 *  3. loyalty points are earned on what they actually spent.
 * Safe to run twice: points are checked against the ledger, and the status machine only completes an order once.
 */
export async function afterOrderCompleted(tx: Tx, orderId: string): Promise<void> {
  const order = await tx.order.findFirst({ where: { id: orderId }, select: { id: true, customerName: true, customerPhone: true, currencyCode: true, subtotalMinor: true, discountMinor: true } });
  if (!order) return;

  const used = await tx.orderDiscount.findMany({ where: { orderId, source: "COUPON", offerId: { not: null } }, select: { offerId: true } });
  for (const u of used) await tx.coupon.updateMany({ where: { id: u.offerId! }, data: { usedCount: { increment: 1 } } });

  const phone = normalizePhone(order.customerPhone);
  if (!phone) return;
  const ctx = requireContext();
  let customer = await tx.customer.findFirst({ where: { phone } });
  if (!customer) customer = await tx.customer.create({ data: { tenantId: ctx.tenantId, name: order.customerName?.trim() || phone, phone } });

  const [program, tenant] = await Promise.all([tx.loyaltyProgram.findFirst({}), tx.tenant.findFirst({ select: { baseCurrency: true } })]);
  if (!program?.isEnabled || tenant?.baseCurrency !== order.currencyCode) return; // points are counted in the organization's own currency
  if (await tx.loyaltyTransaction.findFirst({ where: { orderId, type: "EARN" }, select: { id: true } })) return;
  const points = Math.floor(Math.max(0, order.subtotalMinor - order.discountMinor) / program.earnPerPointMinor);
  if (points <= 0) return;
  const updated = await tx.customer.update({ where: { id: customer.id }, data: { loyaltyPoints: { increment: points } }, select: { loyaltyPoints: true } });
  await tx.loyaltyTransaction.create({ data: { tenantId: ctx.tenantId, customerId: customer.id, type: "EARN", points, balanceAfter: updated.loyaltyPoints, orderId, note: "Earned on an order", createdById: ctx.userId } });
}
