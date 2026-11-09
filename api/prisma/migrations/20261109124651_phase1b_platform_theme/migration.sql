-- AlterEnum
ALTER TYPE "TenantStatus" ADD VALUE 'TRIAL';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "maxLocations" INTEGER,
ADD COLUMN     "maxUsers" INTEGER,
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN     "suspendedReason" TEXT,
ADD COLUMN     "theme" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "trialEndsAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "platform_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_sessions" (
    "id" UUID NOT NULL,
    "platformUserId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "prevRefreshTokenHash" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "platformUserId" UUID,
    "tenantId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "requestId" TEXT,
    "ip" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "platform_sessions_refreshTokenHash_key" ON "platform_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "platform_sessions_platformUserId_idx" ON "platform_sessions"("platformUserId");

-- CreateIndex
CREATE INDEX "platform_audit_logs_occurredAt_id_idx" ON "platform_audit_logs"("occurredAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "platform_audit_logs_tenantId_occurredAt_idx" ON "platform_audit_logs"("tenantId", "occurredAt" DESC);

-- AddForeignKey
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written additions
ALTER TABLE "platform_users" ADD CONSTRAINT "ck_platform_users_email_lowercase" CHECK ("email" = lower("email"));
ALTER TABLE "tenants" ADD CONSTRAINT "ck_tenants_limits_positive" CHECK (("maxLocations" IS NULL OR "maxLocations" >= 1) AND ("maxUsers" IS NULL OR "maxUsers" >= 1));

-- The platform audit log is append-only like the tenant one (same trigger function and purge override).
CREATE TRIGGER "trg_platform_audit_logs_append_only" BEFORE UPDATE OR DELETE ON "platform_audit_logs" FOR EACH ROW EXECUTE FUNCTION restoflux_block_mutation();
