-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('OPEN', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "OrderLineKind" AS ENUM ('ITEM', 'COMBO', 'COMBO_ITEM');

-- CreateEnum
CREATE TYPE "OrderLineStatus" AS ENUM ('NEW', 'PREPARING', 'READY', 'SERVED', 'VOIDED');

-- CreateEnum
CREATE TYPE "DiscountSource" AS ENUM ('MANUAL', 'COUPON', 'PROMOTION');

-- CreateEnum
CREATE TYPE "DiscountValueType" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "PaymentRecordStatus" AS ENUM ('CAPTURED', 'VOIDED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('CASH_IN', 'CASH_OUT', 'PAID_OUT', 'SAFE_DROP');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ZReportScope" AS ENUM ('SHIFT', 'DAY');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "channel" "PriceChannel" NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "displayNumber" INTEGER,
    "aggregatorName" TEXT,
    "aggregatorRef" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "tableId" UUID,
    "covers" INTEGER,
    "deliveryAddress" JSONB,
    "currencyCode" CHAR(3) NOT NULL,
    "subtotalMinor" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "deliveryFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "tipMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "pricesIncludeTax" BOOLEAN NOT NULL,
    "notes" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "placedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReasonId" UUID,
    "cancelNote" TEXT,
    "createdById" UUID,
    "cashShiftId" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "parentLineId" UUID,
    "kind" "OrderLineKind" NOT NULL,
    "variantId" UUID,
    "comboId" UUID,
    "nameSnapshot" TEXT NOT NULL,
    "variantNameSnapshot" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "modifiersTotalMinor" INTEGER NOT NULL DEFAULT 0,
    "lineSubtotalMinor" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "lineTotalMinor" INTEGER NOT NULL,
    "stationKey" TEXT,
    "status" "OrderLineStatus" NOT NULL DEFAULT 'NEW',
    "sentToKitchenAt" TIMESTAMPTZ(3),
    "readyAt" TIMESTAMPTZ(3),
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" UUID,
    "voidReasonId" UUID,
    "voidNote" TEXT,
    "voidApprovalId" UUID,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line_modifiers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "order_line_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line_taxes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "ruleId" UUID,
    "ruleNameSnapshot" TEXT NOT NULL,
    "authorityCode" TEXT NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "baseMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL,
    "isInclusive" BOOLEAN NOT NULL,

    CONSTRAINT "order_line_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_discounts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "source" "DiscountSource" NOT NULL DEFAULT 'MANUAL',
    "valueType" "DiscountValueType" NOT NULL,
    "value" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reasonId" UUID,
    "note" TEXT,
    "appliedById" UUID,
    "approvalId" UUID,

    CONSTRAINT "order_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "order_status",
    "toStatus" "order_status" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byUserId" UUID,
    "note" TEXT,

    CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "paymentMethodId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "tenderedMinor" INTEGER NOT NULL,
    "changeMinor" INTEGER NOT NULL DEFAULT 0,
    "tipMinor" INTEGER NOT NULL DEFAULT 0,
    "currencyCode" CHAR(3) NOT NULL,
    "reference" TEXT,
    "status" "PaymentRecordStatus" NOT NULL DEFAULT 'CAPTURED',
    "cashShiftId" UUID,
    "receivedById" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "paymentMethodId" UUID NOT NULL,
    "reasonId" UUID NOT NULL,
    "note" TEXT,
    "cashShiftId" UUID,
    "requestedById" UUID,
    "approvalId" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_sequences" (
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_sequences_pkey" PRIMARY KEY ("locationId","businessDate")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_shifts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "registerId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "currencyCode" CHAR(3) NOT NULL,
    "openedById" UUID NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingFloatMinor" INTEGER NOT NULL,
    "closedById" UUID,
    "closedAt" TIMESTAMPTZ(3),
    "expectedCashMinor" INTEGER,
    "countedCashMinor" INTEGER,
    "varianceMinor" INTEGER,
    "isBlindClose" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reasonId" UUID,
    "note" TEXT,
    "approvalId" UUID,
    "createdById" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "z_reports" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "scope" "ZReportScope" NOT NULL,
    "cashShiftId" UUID,
    "generatedById" UUID,
    "generatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,

    CONSTRAINT "z_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_tenantId_locationId_businessDate_idx" ON "orders"("tenantId", "locationId", "businessDate");

-- CreateIndex
CREATE INDEX "orders_tenantId_locationId_status_idx" ON "orders"("tenantId", "locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenantId_id_key" ON "orders"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_locationId_businessDate_displayNumber_key" ON "orders"("locationId", "businessDate", "displayNumber");

-- CreateIndex
CREATE INDEX "order_lines_tenantId_orderId_idx" ON "order_lines"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "order_lines_tenantId_locationId_status_idx" ON "order_lines"("tenantId", "locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_tenantId_id_key" ON "order_lines"("tenantId", "id");

-- CreateIndex
CREATE INDEX "order_line_modifiers_tenantId_lineId_idx" ON "order_line_modifiers"("tenantId", "lineId");

-- CreateIndex
CREATE INDEX "order_line_taxes_tenantId_lineId_idx" ON "order_line_taxes"("tenantId", "lineId");

-- CreateIndex
CREATE INDEX "order_discounts_tenantId_orderId_idx" ON "order_discounts"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "order_status_events_tenantId_orderId_at_idx" ON "order_status_events"("tenantId", "orderId", "at");

-- CreateIndex
CREATE INDEX "payments_tenantId_locationId_businessDate_idx" ON "payments"("tenantId", "locationId", "businessDate");

-- CreateIndex
CREATE INDEX "payments_tenantId_orderId_idx" ON "payments"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_id_key" ON "payments"("tenantId", "id");

-- CreateIndex
CREATE INDEX "refunds_tenantId_locationId_businessDate_idx" ON "refunds"("tenantId", "locationId", "businessDate");

-- CreateIndex
CREATE INDEX "refunds_tenantId_orderId_idx" ON "refunds"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "order_sequences_tenantId_idx" ON "order_sequences"("tenantId");

-- CreateIndex
CREATE INDEX "cash_registers_tenantId_locationId_idx" ON "cash_registers"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_registers_tenantId_id_key" ON "cash_registers"("tenantId", "id");

-- CreateIndex
CREATE INDEX "cash_shifts_tenantId_locationId_status_idx" ON "cash_shifts"("tenantId", "locationId", "status");

-- CreateIndex
CREATE INDEX "cash_shifts_tenantId_locationId_businessDate_idx" ON "cash_shifts"("tenantId", "locationId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "cash_shifts_tenantId_id_key" ON "cash_shifts"("tenantId", "id");

-- CreateIndex
CREATE INDEX "cash_movements_tenantId_shiftId_idx" ON "cash_movements"("tenantId", "shiftId");

-- CreateIndex
CREATE INDEX "z_reports_tenantId_locationId_businessDate_idx" ON "z_reports"("tenantId", "locationId", "businessDate");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "orders"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_modifiers" ADD CONSTRAINT "order_line_modifiers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_modifiers" ADD CONSTRAINT "order_line_modifiers_tenantId_lineId_fkey" FOREIGN KEY ("tenantId", "lineId") REFERENCES "order_lines"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_taxes" ADD CONSTRAINT "order_line_taxes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_taxes" ADD CONSTRAINT "order_line_taxes_tenantId_lineId_fkey" FOREIGN KEY ("tenantId", "lineId") REFERENCES "order_lines"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discounts_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "orders"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "orders"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "orders"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_paymentMethodId_fkey" FOREIGN KEY ("tenantId", "paymentMethodId") REFERENCES "payment_methods"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "orders"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenantId_paymentMethodId_fkey" FOREIGN KEY ("tenantId", "paymentMethodId") REFERENCES "payment_methods"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_sequences" ADD CONSTRAINT "order_sequences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_tenantId_registerId_fkey" FOREIGN KEY ("tenantId", "registerId") REFERENCES "cash_registers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenantId_shiftId_fkey" FOREIGN KEY ("tenantId", "shiftId") REFERENCES "cash_shifts"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "z_reports" ADD CONSTRAINT "z_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Hand-written additions (Prisma cannot express these)
-- ============================================================================

-- Rules the database enforces even if application code has a bug.
ALTER TABLE "orders"        ADD CONSTRAINT "ck_orders_money"      CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "taxMinor" >= 0 AND "deliveryFeeMinor" >= 0 AND "tipMinor" >= 0 AND "totalMinor" >= 0 AND "paidMinor" >= 0 AND "refundedMinor" >= 0);
ALTER TABLE "orders"        ADD CONSTRAINT "ck_orders_refund_within_paid" CHECK ("refundedMinor" <= "paidMinor");
ALTER TABLE "orders"        ADD CONSTRAINT "ck_orders_covers"     CHECK ("covers" IS NULL OR "covers" >= 0);
ALTER TABLE "order_lines"   ADD CONSTRAINT "ck_order_lines_qty"   CHECK ("quantity" > 0 AND "unitPriceMinor" >= 0 AND "lineSubtotalMinor" >= 0 AND "lineTotalMinor" >= 0);
ALTER TABLE "order_line_modifiers" ADD CONSTRAINT "ck_order_line_modifiers" CHECK ("quantity" > 0 AND "priceMinor" >= 0);
ALTER TABLE "order_discounts" ADD CONSTRAINT "ck_order_discounts"  CHECK ("value" >= 0 AND "amountMinor" >= 0);
ALTER TABLE "payments"      ADD CONSTRAINT "ck_payments_amount"   CHECK ("amountMinor" > 0 AND "tenderedMinor" >= "amountMinor" AND "changeMinor" >= 0 AND "tipMinor" >= 0);
ALTER TABLE "refunds"       ADD CONSTRAINT "ck_refunds_amount"    CHECK ("amountMinor" > 0);
ALTER TABLE "cash_movements" ADD CONSTRAINT "ck_cash_movements_amount" CHECK ("amountMinor" > 0);
ALTER TABLE "cash_shifts"   ADD CONSTRAINT "ck_cash_shifts_float" CHECK ("openingFloatMinor" >= 0);

-- One OPEN shift per register at a time.
CREATE UNIQUE INDEX "uq_cash_shifts_one_open_per_register" ON "cash_shifts" ("registerId") WHERE "status" = 'OPEN';
-- Register names are unique per branch among live rows.
CREATE UNIQUE INDEX "uq_cash_registers_name" ON "cash_registers" ("tenantId", "locationId", lower("name")) WHERE "deletedAt" IS NULL;

-- Append-only: payments, refunds, cash movements, status history and Z-reports are never edited or deleted
-- (a mistake is corrected by a NEW row). The purge helper lifts this for tests and tenant removal only.
CREATE TRIGGER "trg_payments_append_only"           BEFORE UPDATE OR DELETE ON "payments"           FOR EACH ROW EXECUTE FUNCTION restoflux_block_mutation();
CREATE TRIGGER "trg_refunds_append_only"            BEFORE UPDATE OR DELETE ON "refunds"            FOR EACH ROW EXECUTE FUNCTION restoflux_block_mutation();
CREATE TRIGGER "trg_cash_movements_append_only"     BEFORE UPDATE OR DELETE ON "cash_movements"     FOR EACH ROW EXECUTE FUNCTION restoflux_block_mutation();
CREATE TRIGGER "trg_order_status_events_append_only" BEFORE UPDATE OR DELETE ON "order_status_events" FOR EACH ROW EXECUTE FUNCTION restoflux_block_mutation();
CREATE TRIGGER "trg_z_reports_append_only"          BEFORE UPDATE OR DELETE ON "z_reports"          FOR EACH ROW EXECUTE FUNCTION restoflux_block_mutation();
