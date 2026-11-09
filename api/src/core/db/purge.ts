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
      await tx.auditLog.deleteMany({ where });
      await tx.platformAuditLog.deleteMany({ where }); // what the Restoflux team did to this tenant
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
