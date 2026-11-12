-- CreateEnum
CREATE TYPE "InventoryItemKind" AS ENUM ('RAW', 'PREP', 'PACKAGING');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING', 'PURCHASE', 'SALE', 'SALE_REVERSAL', 'ADJUSTMENT', 'WASTE', 'EXPIRED', 'DAMAGE', 'STAFF_MEAL', 'COUNT', 'TRANSFER_OUT', 'TRANSFER_IN', 'PRODUCTION_IN', 'PRODUCTION_OUT');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('REQUESTED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "kind" "InventoryItemKind" NOT NULL DEFAULT 'RAW',
    "unit" TEXT NOT NULL,
    "category" TEXT,
    "referenceCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(14,3),
    "parLevel" DECIMAL(14,3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "businessDate" DATE NOT NULL,
    "reason" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "variantId" UUID,
    "prepItemId" UUID,
    "yieldQty" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "recipeId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "wastePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recipe_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "businessDate" DATE NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "submittedAt" TIMESTAMPTZ(3),
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "countId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "expectedQty" DECIMAL(14,3) NOT NULL,
    "countedQty" DECIMAL(14,3),
    "unitCost" DECIMAL(18,6) NOT NULL DEFAULT 0,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "fromLocationId" UUID NOT NULL,
    "toLocationId" UUID NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "requestedById" UUID,
    "shippedAt" TIMESTAMPTZ(3),
    "receivedById" UUID,
    "receivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "receivedQty" DECIMAL(14,3),
    "unitCost" DECIMAL(18,6) NOT NULL DEFAULT 0,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_runs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "prepItemId" UUID NOT NULL,
    "producedQty" DECIMAL(14,3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_items_tenantId_name_idx" ON "inventory_items"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_tenantId_id_key" ON "inventory_items"("tenantId", "id");

-- CreateIndex
CREATE INDEX "stock_levels_tenantId_locationId_idx" ON "stock_levels"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_locationId_itemId_key" ON "stock_levels"("locationId", "itemId");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_locationId_itemId_createdAt_idx" ON "stock_movements"("tenantId", "locationId", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_locationId_businessDate_idx" ON "stock_movements"("tenantId", "locationId", "businessDate");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_refType_refId_idx" ON "stock_movements"("tenantId", "refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_tenantId_id_key" ON "recipes"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_variantId_key" ON "recipes"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_prepItemId_key" ON "recipes"("prepItemId");

-- CreateIndex
CREATE INDEX "recipe_lines_tenantId_recipeId_idx" ON "recipe_lines"("tenantId", "recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_lines_recipeId_itemId_key" ON "recipe_lines"("recipeId", "itemId");

-- CreateIndex
CREATE INDEX "stock_counts_tenantId_locationId_status_idx" ON "stock_counts"("tenantId", "locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_tenantId_id_key" ON "stock_counts"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_tenantId_number_key" ON "stock_counts"("tenantId", "number");

-- CreateIndex
CREATE INDEX "stock_count_lines_tenantId_countId_idx" ON "stock_count_lines"("tenantId", "countId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_countId_itemId_key" ON "stock_count_lines"("countId", "itemId");

-- CreateIndex
CREATE INDEX "stock_transfers_tenantId_fromLocationId_status_idx" ON "stock_transfers"("tenantId", "fromLocationId", "status");

-- CreateIndex
CREATE INDEX "stock_transfers_tenantId_toLocationId_status_idx" ON "stock_transfers"("tenantId", "toLocationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenantId_id_key" ON "stock_transfers"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenantId_number_key" ON "stock_transfers"("tenantId", "number");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_tenantId_transferId_idx" ON "stock_transfer_lines"("tenantId", "transferId");

-- CreateIndex
CREATE INDEX "production_runs_tenantId_locationId_createdAt_idx" ON "production_runs"("tenantId", "locationId", "createdAt");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenantId_itemId_fkey" FOREIGN KEY ("tenantId", "itemId") REFERENCES "inventory_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenantId_itemId_fkey" FOREIGN KEY ("tenantId", "itemId") REFERENCES "inventory_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_tenantId_variantId_fkey" FOREIGN KEY ("tenantId", "variantId") REFERENCES "product_variants"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_tenantId_prepItemId_fkey" FOREIGN KEY ("tenantId", "prepItemId") REFERENCES "inventory_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_tenantId_recipeId_fkey" FOREIGN KEY ("tenantId", "recipeId") REFERENCES "recipes"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_tenantId_itemId_fkey" FOREIGN KEY ("tenantId", "itemId") REFERENCES "inventory_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_tenantId_countId_fkey" FOREIGN KEY ("tenantId", "countId") REFERENCES "stock_counts"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_tenantId_itemId_fkey" FOREIGN KEY ("tenantId", "itemId") REFERENCES "inventory_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_tenantId_transferId_fkey" FOREIGN KEY ("tenantId", "transferId") REFERENCES "stock_transfers"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_tenantId_itemId_fkey" FOREIGN KEY ("tenantId", "itemId") REFERENCES "inventory_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_tenantId_prepItemId_fkey" FOREIGN KEY ("tenantId", "prepItemId") REFERENCES "inventory_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A recipe belongs to exactly one thing: a menu variant or a prep item.
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_one_target" CHECK (("variantId" IS NOT NULL)::int + ("prepItemId" IS NOT NULL)::int = 1);
-- A ledger row that moves nothing is a bug.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_qty_nonzero" CHECK ("qty" <> 0);
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_unit_valid" CHECK ("unit" IN ('kg','g','l','ml','pcs'));
-- SKU is unique per organization while the item is not archived.
CREATE UNIQUE INDEX "inventory_items_tenant_sku_active" ON "inventory_items" ("tenantId", lower("sku")) WHERE "sku" IS NOT NULL AND "deletedAt" IS NULL;
-- The ledger is append-only: a mistake is corrected by a new row, never an edit.
CREATE TRIGGER "trg_stock_movements_append_only" BEFORE UPDATE OR DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION restoflux_block_mutation();
