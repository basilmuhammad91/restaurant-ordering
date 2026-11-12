-- The platform audit log refers to the organization acted on. It is NOT a tenant-owned table (it belongs to
-- the Restoflux team), so the column is named targetTenantId to keep the rule "a column called tenantId means
-- tenant-scoped" true everywhere.
ALTER TABLE "platform_audit_logs" RENAME COLUMN "tenantId" TO "targetTenantId";
ALTER INDEX "platform_audit_logs_tenantId_occurredAt_idx" RENAME TO "platform_audit_logs_targetTenantId_occurredAt_idx";
