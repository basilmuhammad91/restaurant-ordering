-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "supplierSku" TEXT,
    "packName" TEXT NOT NULL DEFAULT 'Each',
    "packQty" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "priceMinor" INTEGER NOT NULL,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currencyCode" CHAR(3) NOT NULL,
    "expectedDate" DATE,
    "note" TEXT,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "packName" TEXT NOT NULL,
    "packQty" DECIMAL(14,3) NOT NULL,
    "orderedPacks" DECIMAL(14,3) NOT NULL,
    "receivedPacks" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unitPriceMinor" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "orderId" UUID,
    "number" TEXT NOT NULL,
    "note" TEXT,
    "receivedById" UUID,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "packs" DECIMAL(14,3) NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(18,6) NOT NULL,
    "totalMinor" INTEGER NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "orderId" UUID,
    "invoiceNo" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_tenantId_name_idx" ON "suppliers"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenantId_id_key" ON "suppliers"("tenantId", "id");

-- CreateIndex
CREATE INDEX "supplier_items_tenantId_itemId_idx" ON "supplier_items"("tenantId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_items_supplierId_itemId_packName_key" ON "supplier_items"("supplierId", "itemId", "packName");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_locationId_status_idx" ON "purchase_orders"("tenantId", "locationId", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_supplierId_idx" ON "purchase_orders"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenantId_id_key" ON "purchase_orders"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenantId_number_key" ON "purchase_orders"("tenantId", "number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_tenantId_orderId_idx" ON "purchase_order_lines"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_orderId_itemId_key" ON "purchase_order_lines"("orderId", "itemId");

-- CreateIndex
CREATE INDEX "goods_receipts_tenantId_locationId_receivedAt_idx" ON "goods_receipts"("tenantId", "locationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenantId_id_key" ON "goods_receipts"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenantId_number_key" ON "goods_receipts"("tenantId", "number");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_tenantId_receiptId_idx" ON "goods_receipt_lines"("tenantId", "receiptId");

-- CreateIndex
CREATE INDEX "supplier_invoices_tenantId_status_dueDate_idx" ON "supplier_invoices"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_tenantId_id_key" ON "supplier_invoices"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_supplierId_invoiceNo_key" ON "supplier_invoices"("supplierId", "invoiceNo");

-- CreateIndex
CREATE INDEX "supplier_payments_tenantId_invoiceId_idx" ON "supplier_payments"("tenantId", "invoiceId");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "suppliers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_tenantId_itemId_fkey" FOREIGN KEY ("tenantId", "itemId") REFERENCES "inventory_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "suppliers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "purchase_orders"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenantId_itemId_fkey" FOREIGN KEY ("tenantId", "itemId") REFERENCES "inventory_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "suppliers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "purchase_orders"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenantId_receiptId_fkey" FOREIGN KEY ("tenantId", "receiptId") REFERENCES "goods_receipts"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenantId_itemId_fkey" FOREIGN KEY ("tenantId", "itemId") REFERENCES "inventory_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "suppliers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "purchase_orders"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "supplier_invoices"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_paid_within_total" CHECK ("paidMinor" >= 0 AND "paidMinor" <= "totalMinor");
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "po_lines_positive" CHECK ("orderedPacks" > 0 AND "receivedPacks" >= 0);
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_pack_positive" CHECK ("packQty" > 0 AND "priceMinor" >= 0);
CREATE UNIQUE INDEX "suppliers_tenant_code_active" ON "suppliers" ("tenantId", lower("code")) WHERE "code" IS NOT NULL AND "deletedAt" IS NULL;
-- Money paid to a supplier is a record, never edited.
CREATE TRIGGER "trg_supplier_payments_append_only" BEFORE UPDATE OR DELETE ON "supplier_payments" FOR EACH ROW EXECUTE FUNCTION restoflux_block_mutation();
