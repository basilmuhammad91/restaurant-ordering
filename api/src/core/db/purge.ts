import { unscopedDb } from "./client.js";

/**
 * Delete a tenant and everything it owns. For tests, `seed --reset` and tenant removal scripts.
 * Children first (foreign keys). The append-only triggers on audit_logs / login_events are lifted for
 * this one transaction only, via the app.allow_purge setting, which normal request code never sets.
 */
export async function purgeTenant(tenantId: string): Promise<void> {
  await unscopedDb.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.allow_purge', 'on', true)`;
      const where = { tenantId };
      await tx.notificationPreference.deleteMany({ where });
      await tx.notification.deleteMany({ where });
      await tx.approvalRequest.deleteMany({ where });
      await deleteOperations(tx, tenantId);
      await deleteMarketing(tx, tenantId);
      await deleteSales(tx, tenantId);
      await deletePurchasing(tx, tenantId);
      await deleteInventory(tx, tenantId);
      await deleteCatalog(tx, tenantId);
      await tx.auditLog.deleteMany({ where });
      await tx.platformAuditLog.deleteMany({ where: { targetTenantId: tenantId } }); // what the Restoflux team did to this tenant
      await tx.loginEvent.deleteMany({ where });
      await tx.session.deleteMany({ where });
      await tx.userLocation.deleteMany({ where });
      await tx.userRole.deleteMany({ where });
      await tx.roleLimit.deleteMany({ where });
      await tx.rolePermission.deleteMany({ where });
      await tx.user.deleteMany({ where });
      await tx.role.deleteMany({ where });
      await tx.locationPaymentMethod.deleteMany({ where });
      await tx.locationOpeningHour.deleteMany({ where });
      await tx.diningTable.deleteMany({ where });
      await tx.kitchenStation.deleteMany({ where });
      await tx.taxRule.deleteMany({ where });
      await tx.location.deleteMany({ where });
      await tx.priceBook.deleteMany({ where });
      await tx.taxProfile.deleteMany({ where });
      await tx.taxCategory.deleteMany({ where });
      await tx.paymentMethod.deleteMany({ where });
      await tx.reasonCode.deleteMany({ where });
      await tx.brand.deleteMany({ where });
      await tx.tenant.deleteMany({ where: { id: tenantId } });
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}

/** Delete a platform (Restoflux team) account and its history. For tests and scripts only. */
export async function purgePlatformUser(platformUserId: string): Promise<void> {
  await unscopedDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.allow_purge', 'on', true)`;
    await tx.platformAuditLog.deleteMany({ where: { platformUserId } });
    await tx.platformSession.deleteMany({ where: { platformUserId } });
    await tx.platformUser.deleteMany({ where: { id: platformUserId } });
  });
}

type PurgeTx = Parameters<Parameters<typeof unscopedDb.$transaction>[0]>[0];

/** Delete a tenant's delivery, staff, roster, time clock and receipt template, children first. */
export async function deleteOperations(tx: PurgeTx, tenantId: string): Promise<void> {
  const where = { tenantId };
  await tx.timeEntry.deleteMany({ where });
  await tx.rosterShift.deleteMany({ where });
  await tx.employee.deleteMany({ where });
  await tx.deliveryAssignment.deleteMany({ where });
  await tx.rider.deleteMany({ where });
  await tx.deliveryZone.deleteMany({ where });
  await tx.receiptTemplate.deleteMany({ where });
}

/** Delete a tenant's customers, loyalty, coupons, promotions and feedback, children first. */
export async function deleteMarketing(tx: PurgeTx, tenantId: string): Promise<void> {
  const where = { tenantId };
  await tx.$executeRaw`SELECT set_config('app.allow_purge', 'on', true)`;
  await tx.feedback.deleteMany({ where });
  await tx.loyaltyTransaction.deleteMany({ where });
  await tx.coupon.deleteMany({ where });
  await tx.promotion.deleteMany({ where });
  await tx.loyaltyProgram.deleteMany({ where });
  await tx.customer.deleteMany({ where });
}

/** Delete a tenant's suppliers, purchase orders, receipts, invoices and payments, children first. */
export async function deletePurchasing(tx: PurgeTx, tenantId: string): Promise<void> {
  const where = { tenantId };
  await tx.$executeRaw`SELECT set_config('app.allow_purge', 'on', true)`;
  await tx.supplierPayment.deleteMany({ where });
  await tx.supplierInvoice.deleteMany({ where });
  await tx.goodsReceiptLine.deleteMany({ where });
  await tx.goodsReceipt.deleteMany({ where });
  await tx.purchaseOrderLine.deleteMany({ where });
  await tx.purchaseOrder.deleteMany({ where });
  await tx.supplierItem.deleteMany({ where });
  await tx.supplier.deleteMany({ where });
}

/** Delete a tenant's stock records and recipes, children first (the ledger is append-only: the purge override lifts that). */
export async function deleteInventory(tx: PurgeTx, tenantId: string): Promise<void> {
  const where = { tenantId };
  await tx.$executeRaw`SELECT set_config('app.allow_purge', 'on', true)`;
  await tx.stockMovement.deleteMany({ where });
  await tx.stockLevel.deleteMany({ where });
  await tx.stockCountLine.deleteMany({ where });
  await tx.stockCount.deleteMany({ where });
  await tx.stockTransferLine.deleteMany({ where });
  await tx.stockTransfer.deleteMany({ where });
  await tx.productionRun.deleteMany({ where });
  await tx.recipeLine.deleteMany({ where });
  await tx.recipe.deleteMany({ where });
  await tx.inventoryItem.deleteMany({ where });
}

/** Delete a tenant's whole catalog (menu, prices, availability), children first. Used by tenant purge and the demo menu reset. */
export async function deleteCatalog(tx: PurgeTx, tenantId: string): Promise<void> {
  const where = { tenantId };
  await tx.locationAvailability.deleteMany({ where });
  await tx.price.deleteMany({ where });
  await tx.menuCombo.deleteMany({ where });
  await tx.menuProduct.deleteMany({ where });
  await tx.menuSchedule.deleteMany({ where });
  await tx.menu.deleteMany({ where });
  await tx.comboSlotOption.deleteMany({ where });
  await tx.comboSlot.deleteMany({ where });
  await tx.combo.deleteMany({ where });
  await tx.productModifierGroup.deleteMany({ where });
  await tx.modifierOption.deleteMany({ where });
  await tx.modifierGroup.deleteMany({ where });
  await tx.productVariant.deleteMany({ where });
  await tx.product.deleteMany({ where });
  await tx.category.deleteMany({ where });
}

/** Delete a tenant's orders, payments, shifts and cash records, children first. */
export async function deleteSales(tx: PurgeTx, tenantId: string): Promise<void> {
  const where = { tenantId };
  await tx.$executeRaw`SELECT set_config('app.allow_purge', 'on', true)`;
  await tx.zReport.deleteMany({ where });
  await tx.cashMovement.deleteMany({ where });
  await tx.cashShift.deleteMany({ where });
  await tx.cashRegister.deleteMany({ where });
  await tx.refund.deleteMany({ where });
  await tx.payment.deleteMany({ where });
  await tx.orderStatusEvent.deleteMany({ where });
  await tx.orderDiscount.deleteMany({ where });
  await tx.orderLineTax.deleteMany({ where });
  await tx.orderLineModifier.deleteMany({ where });
  await tx.orderLine.deleteMany({ where });
  await tx.order.deleteMany({ where });
  await tx.orderSequence.deleteMany({ where });
}
