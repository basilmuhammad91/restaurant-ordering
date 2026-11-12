-- CreateEnum
CREATE TYPE "LoyaltyTxType" AS ENUM ('EARN', 'REDEEM', 'ADJUST');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'REPLIED', 'RESOLVED');

-- AlterTable
ALTER TABLE "order_discounts" ADD COLUMN     "offerId" UUID;

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "birthday" DATE,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_programs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "earnPerPointMinor" INTEGER NOT NULL DEFAULT 10000,
    "redeemValueMinor" INTEGER NOT NULL DEFAULT 100,
    "minRedeemPoints" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "LoyaltyTxType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "orderId" UUID,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "valueType" "DiscountValueType" NOT NULL,
    "value" INTEGER NOT NULL,
    "minSubtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" DATE,
    "validTo" DATE,
    "customerId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "valueType" "DiscountValueType" NOT NULL,
    "value" INTEGER NOT NULL,
    "minSubtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "validFrom" DATE,
    "validTo" DATE,
    "daysOfWeek" INTEGER[],
    "startTime" TEXT,
    "endTime" TEXT,
    "locationIds" UUID[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "orderId" UUID,
    "customerId" UUID,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "source" TEXT NOT NULL DEFAULT 'STAFF',
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "reply" TEXT,
    "repliedById" UUID,
    "repliedAt" TIMESTAMPTZ(3),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_tenantId_name_idx" ON "customers"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_id_key" ON "customers"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_tenantId_key" ON "loyalty_programs"("tenantId");

-- CreateIndex
CREATE INDEX "loyalty_transactions_tenantId_customerId_createdAt_idx" ON "loyalty_transactions"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_tenantId_id_key" ON "coupons"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_tenantId_id_key" ON "promotions"("tenantId", "id");

-- CreateIndex
CREATE INDEX "feedback_tenantId_locationId_createdAt_idx" ON "feedback"("tenantId", "locationId", "createdAt");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE UNIQUE INDEX "customers_tenant_phone_active" ON "customers" ("tenantId", "phone") WHERE "phone" IS NOT NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "coupons_tenant_code_active" ON "coupons" ("tenantId", lower("code")) WHERE "deletedAt" IS NULL;
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_value_valid" CHECK ("value" >= 0 AND ("valueType" <> 'PERCENT' OR "value" <= 10000));
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_value_valid" CHECK ("value" >= 0 AND ("valueType" <> 'PERCENT' OR "value" <= 10000));
-- Points history is a ledger: never edited.
CREATE TRIGGER "trg_loyalty_transactions_append_only" BEFORE UPDATE OR DELETE ON "loyalty_transactions" FOR EACH ROW EXECUTE FUNCTION restoflux_block_mutation();
