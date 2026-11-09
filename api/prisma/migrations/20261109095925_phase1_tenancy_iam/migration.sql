-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');

-- CreateEnum
CREATE TYPE "SessionAudience" AS ENUM ('STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('VOID', 'REFUND', 'DISCOUNT', 'STOCK_ADJUSTMENT', 'STOCK_COUNT', 'TRANSFER', 'PURCHASE_ORDER', 'CASH_OUT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "ApprovalMethod" AS ENUM ('INLINE_PIN', 'INBOX');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARN', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('BRANCH', 'WAREHOUSE', 'CENTRAL_KITCHEN');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CASH', 'CARD', 'WALLET', 'QR', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'TAKEAWAY', 'DELIVERY');

-- CreateEnum
CREATE TYPE "ReasonType" AS ENUM ('VOID', 'REFUND', 'DISCOUNT', 'ADJUSTMENT', 'CASH_OUT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "posPinHash" TEXT,
    "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMPTZ(3),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "allLocations" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "lastLoginAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "unlimitedLimits" BOOLEAN NOT NULL DEFAULT false,
    "maxDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_limits" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "voidLimitMinor" INTEGER NOT NULL,
    "refundLimitMinor" INTEGER NOT NULL,
    "poApprovalLimitMinor" INTEGER NOT NULL,
    "adjustmentLimitMinor" INTEGER NOT NULL,

    CONSTRAINT "role_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "user_locations" (
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "locationId" UUID NOT NULL,

    CONSTRAINT "user_locations_pkey" PRIMARY KEY ("userId","locationId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "audience" "SessionAudience" NOT NULL DEFAULT 'STAFF',
    "refreshTokenHash" TEXT NOT NULL,
    "prevRefreshTokenHash" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID,
    "emailAttempted" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID,
    "type" "ApprovalType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "payloadHash" TEXT NOT NULL,
    "amountMinor" INTEGER,
    "currencyCode" CHAR(3),
    "reason" TEXT NOT NULL,
    "requestedById" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "method" "ApprovalMethod" NOT NULL DEFAULT 'INBOX',
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID,
    "actorUserId" UUID,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "requestId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID,
    "userId" UUID,
    "requiredPermission" TEXT,
    "type" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "minorUnitExponent" INTEGER NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "baseCurrency" CHAR(3) NOT NULL,
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "authVersion" INTEGER NOT NULL DEFAULT 0,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "cuisine" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "LocationType" NOT NULL,
    "brandId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "city" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "timezone" TEXT NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "taxProfileId" UUID,
    "priceBookId" UUID,
    "businessDayStartTime" TEXT NOT NULL DEFAULT '05:00',
    "receiptHeader" TEXT,
    "receiptFooter" TEXT,
    "orderPrefix" TEXT,
    "acceptsOnlineOrders" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_opening_hours" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opensAt" TEXT NOT NULL,
    "closesAt" TEXT NOT NULL,

    CONSTRAINT "location_opening_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "section" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_stations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kitchen_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_categories" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_profiles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "pricesIncludeTax" BOOLEAN NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rules" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "taxProfileId" UUID NOT NULL,
    "taxCategoryId" UUID,
    "name" TEXT NOT NULL,
    "authorityCode" TEXT NOT NULL,
    "ratePercent" DECIMAL(7,4) NOT NULL,
    "isCompound" BOOLEAN NOT NULL DEFAULT false,
    "orderTypes" "OrderType"[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMPTZ(3),
    "validTo" TIMESTAMPTZ(3),

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "providerCode" TEXT,
    "requiresReference" BOOLEAN NOT NULL DEFAULT false,
    "opensDrawer" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_payment_methods" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "paymentMethodId" UUID NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "location_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_books" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "brandId" UUID,
    "name" TEXT NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reason_codes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "ReasonType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requiresNote" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reason_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenantId_status_idx" ON "users"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_id_key" ON "users"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_id_key" ON "roles"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permission_key" ON "role_permissions"("roleId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "role_limits_roleId_currencyCode_key" ON "role_limits"("roleId", "currencyCode");

-- CreateIndex
CREATE INDEX "user_roles_tenantId_idx" ON "user_roles"("tenantId");

-- CreateIndex
CREATE INDEX "user_locations_tenantId_idx" ON "user_locations"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_prevRefreshTokenHash_idx" ON "sessions"("prevRefreshTokenHash");

-- CreateIndex
CREATE INDEX "login_events_tenantId_occurredAt_idx" ON "login_events"("tenantId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "login_events_userId_occurredAt_idx" ON "login_events"("userId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "approval_requests_tenantId_status_createdAt_idx" ON "approval_requests"("tenantId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "approval_requests_tenantId_locationId_idx" ON "approval_requests"("tenantId", "locationId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_occurredAt_id_idx" ON "audit_logs"("tenantId", "occurredAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entityType_entityId_idx" ON "audit_logs"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_actorUserId_occurredAt_idx" ON "audit_logs"("tenantId", "actorUserId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_action_idx" ON "audit_logs"("tenantId", "action");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_createdAt_idx" ON "notifications"("tenantId", "userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenantId_dedupeKey_key" ON "notifications"("tenantId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_type_key" ON "notification_preferences"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE INDEX "brands_tenantId_idx" ON "brands"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "brands_tenantId_id_key" ON "brands"("tenantId", "id");

-- CreateIndex
CREATE INDEX "locations_tenantId_brandId_idx" ON "locations"("tenantId", "brandId");

-- CreateIndex
CREATE INDEX "locations_tenantId_type_idx" ON "locations"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "locations_tenantId_id_key" ON "locations"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "location_opening_hours_locationId_weekday_opensAt_key" ON "location_opening_hours"("locationId", "weekday", "opensAt");

-- CreateIndex
CREATE INDEX "dining_tables_tenantId_locationId_idx" ON "dining_tables"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_tenantId_id_key" ON "dining_tables"("tenantId", "id");

-- CreateIndex
CREATE INDEX "kitchen_stations_tenantId_locationId_idx" ON "kitchen_stations"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_stations_locationId_key_key" ON "kitchen_stations"("locationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "tax_categories_tenantId_id_key" ON "tax_categories"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_profiles_tenantId_id_key" ON "tax_profiles"("tenantId", "id");

-- CreateIndex
CREATE INDEX "tax_rules_tenantId_taxProfileId_idx" ON "tax_rules"("tenantId", "taxProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_tenantId_id_key" ON "payment_methods"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "location_payment_methods_locationId_paymentMethodId_key" ON "location_payment_methods"("locationId", "paymentMethodId");

-- CreateIndex
CREATE UNIQUE INDEX "price_books_tenantId_id_key" ON "price_books"("tenantId", "id");

-- CreateIndex
CREATE INDEX "reason_codes_tenantId_type_idx" ON "reason_codes"("tenantId", "type");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenantId_roleId_fkey" FOREIGN KEY ("tenantId", "roleId") REFERENCES "roles"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_limits" ADD CONSTRAINT "role_limits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_limits" ADD CONSTRAINT "role_limits_tenantId_roleId_fkey" FOREIGN KEY ("tenantId", "roleId") REFERENCES "roles"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "users"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenantId_roleId_fkey" FOREIGN KEY ("tenantId", "roleId") REFERENCES "roles"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "users"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "users"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_baseCurrency_fkey" FOREIGN KEY ("baseCurrency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "tax_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "price_books"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_opening_hours" ADD CONSTRAINT "location_opening_hours_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_opening_hours" ADD CONSTRAINT "location_opening_hours_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_categories" ADD CONSTRAINT "tax_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_tenantId_taxProfileId_fkey" FOREIGN KEY ("tenantId", "taxProfileId") REFERENCES "tax_profiles"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_taxCategoryId_fkey" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_payment_methods" ADD CONSTRAINT "location_payment_methods_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_payment_methods" ADD CONSTRAINT "location_payment_methods_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_payment_methods" ADD CONSTRAINT "location_payment_methods_tenantId_paymentMethodId_fkey" FOREIGN KEY ("tenantId", "paymentMethodId") REFERENCES "payment_methods"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reason_codes" ADD CONSTRAINT "reason_codes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Hand-written SQL (Prisma cannot express these). See docs/DATA_MODEL.md section 5.
-- Columns are camelCase and must be quoted.
-- ============================================================================

-- 1) Soft delete: uniqueness applies only to rows that are not archived.
CREATE UNIQUE INDEX "uq_brands_tenant_name"            ON "brands"          ("tenantId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_locations_tenant_code"         ON "locations"       ("tenantId", "code")        WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_dining_tables_location_name"   ON "dining_tables"   ("locationId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_tax_categories_tenant_name"    ON "tax_categories"  ("tenantId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_tax_profiles_tenant_name"      ON "tax_profiles"    ("tenantId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_payment_methods_tenant_name"   ON "payment_methods" ("tenantId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_price_books_tenant_name"       ON "price_books"     ("tenantId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_roles_tenant_name"             ON "roles"           ("tenantId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_reason_codes_tenant_type_code" ON "reason_codes"    ("tenantId", "type", "code") WHERE "deletedAt" IS NULL;

-- 2) CHECK constraints: rules the database enforces even if application code has a bug.
ALTER TABLE "locations"              ADD CONSTRAINT "ck_locations_branch_has_brand" CHECK ("type" <> 'BRANCH' OR "brandId" IS NOT NULL);
ALTER TABLE "currencies"             ADD CONSTRAINT "ck_currencies_exponent"        CHECK ("minorUnitExponent" BETWEEN 0 AND 4);
ALTER TABLE "users"                  ADD CONSTRAINT "ck_users_email_lowercase"      CHECK ("email" = lower("email"));
ALTER TABLE "roles"                  ADD CONSTRAINT "ck_roles_discount_range"       CHECK ("maxDiscountPercent" BETWEEN 0 AND 100);
ALTER TABLE "role_limits"            ADD CONSTRAINT "ck_role_limits_non_negative"   CHECK ("voidLimitMinor" >= 0 AND "refundLimitMinor" >= 0 AND "poApprovalLimitMinor" >= 0 AND "adjustmentLimitMinor" >= 0);
ALTER TABLE "location_opening_hours" ADD CONSTRAINT "ck_opening_hours_weekday"      CHECK ("weekday" BETWEEN 0 AND 6);
ALTER TABLE "tax_rules"              ADD CONSTRAINT "ck_tax_rules_rate_range"       CHECK ("ratePercent" >= 0 AND "ratePercent" <= 100);

-- 3) Append-only tables: UPDATE and DELETE are rejected, so history cannot be rewritten from the app.
--    The tenant purge helper (tests, scripts) sets app.allow_purge = 'on' inside its own transaction.
CREATE FUNCTION restoflux_block_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_audit_logs_append_only"  BEFORE UPDATE OR DELETE ON "audit_logs"  FOR EACH ROW EXECUTE FUNCTION restoflux_block_mutation();
CREATE TRIGGER "trg_login_events_append_only" BEFORE UPDATE OR DELETE ON "login_events" FOR EACH ROW EXECUTE FUNCTION restoflux_block_mutation();
