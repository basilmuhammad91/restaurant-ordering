-- CreateEnum
CREATE TYPE "PriceChannel" AS ENUM ('POS', 'WEB', 'ANDROID', 'IOS', 'PHONE', 'AGGREGATOR');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "sku" TEXT,
    "taxCategoryId" UUID,
    "stationKey" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_groups" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_options" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "modifier_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_modifier_groups" (
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "modifierGroupId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "minSelectOverride" INTEGER,
    "maxSelectOverride" INTEGER,

    CONSTRAINT "product_modifier_groups_pkey" PRIMARY KEY ("productId","modifierGroupId")
);

-- CreateTable
CREATE TABLE "menus" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_schedules" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "menuId" UUID NOT NULL,
    "weekdays" INTEGER[],
    "startsAt" TEXT,
    "endsAt" TEXT,

    CONSTRAINT "menu_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_products" (
    "tenantId" UUID NOT NULL,
    "menuId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "menu_products_pkey" PRIMARY KEY ("menuId","productId")
);

-- CreateTable
CREATE TABLE "menu_combos" (
    "tenantId" UUID NOT NULL,
    "menuId" UUID NOT NULL,
    "comboId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "menu_combos_pkey" PRIMARY KEY ("menuId","comboId")
);

-- CreateTable
CREATE TABLE "combos" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "taxCategoryId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "combos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combo_slots" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "comboId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "combo_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combo_slot_options" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "combo_slot_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prices" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "variantId" UUID,
    "modifierOptionId" UUID,
    "comboId" UUID,
    "comboSlotOptionId" UUID,
    "priceBookId" UUID,
    "locationId" UUID,
    "channel" "PriceChannel",
    "amountMinor" INTEGER NOT NULL,
    "compareAtMinor" INTEGER,
    "currencyCode" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_availability" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "productId" UUID,
    "comboId" UUID,
    "modifierOptionId" UUID,
    "isListed" BOOLEAN NOT NULL DEFAULT true,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "soldOutUntil" TIMESTAMPTZ(3),
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "location_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_tenantId_brandId_idx" ON "categories"("tenantId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenantId_id_key" ON "categories"("tenantId", "id");

-- CreateIndex
CREATE INDEX "products_tenantId_brandId_categoryId_idx" ON "products"("tenantId", "brandId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_id_key" ON "products"("tenantId", "id");

-- CreateIndex
CREATE INDEX "product_variants_tenantId_productId_idx" ON "product_variants"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenantId_id_key" ON "product_variants"("tenantId", "id");

-- CreateIndex
CREATE INDEX "modifier_groups_tenantId_brandId_idx" ON "modifier_groups"("tenantId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_groups_tenantId_id_key" ON "modifier_groups"("tenantId", "id");

-- CreateIndex
CREATE INDEX "modifier_options_tenantId_groupId_idx" ON "modifier_options"("tenantId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_options_tenantId_id_key" ON "modifier_options"("tenantId", "id");

-- CreateIndex
CREATE INDEX "product_modifier_groups_tenantId_modifierGroupId_idx" ON "product_modifier_groups"("tenantId", "modifierGroupId");

-- CreateIndex
CREATE INDEX "menus_tenantId_brandId_idx" ON "menus"("tenantId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "menus_tenantId_id_key" ON "menus"("tenantId", "id");

-- CreateIndex
CREATE INDEX "menu_schedules_tenantId_menuId_idx" ON "menu_schedules"("tenantId", "menuId");

-- CreateIndex
CREATE INDEX "menu_products_tenantId_productId_idx" ON "menu_products"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "menu_combos_tenantId_comboId_idx" ON "menu_combos"("tenantId", "comboId");

-- CreateIndex
CREATE INDEX "combos_tenantId_brandId_idx" ON "combos"("tenantId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "combos_tenantId_id_key" ON "combos"("tenantId", "id");

-- CreateIndex
CREATE INDEX "combo_slots_tenantId_comboId_idx" ON "combo_slots"("tenantId", "comboId");

-- CreateIndex
CREATE UNIQUE INDEX "combo_slots_tenantId_id_key" ON "combo_slots"("tenantId", "id");

-- CreateIndex
CREATE INDEX "combo_slot_options_tenantId_slotId_idx" ON "combo_slot_options"("tenantId", "slotId");

-- CreateIndex
CREATE INDEX "combo_slot_options_tenantId_variantId_idx" ON "combo_slot_options"("tenantId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "combo_slot_options_tenantId_id_key" ON "combo_slot_options"("tenantId", "id");

-- CreateIndex
CREATE INDEX "prices_tenantId_variantId_idx" ON "prices"("tenantId", "variantId");

-- CreateIndex
CREATE INDEX "prices_tenantId_priceBookId_idx" ON "prices"("tenantId", "priceBookId");

-- CreateIndex
CREATE INDEX "prices_tenantId_locationId_idx" ON "prices"("tenantId", "locationId");

-- CreateIndex
CREATE INDEX "location_availability_tenantId_locationId_idx" ON "location_availability"("tenantId", "locationId");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenantId_brandId_fkey" FOREIGN KEY ("tenantId", "brandId") REFERENCES "brands"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_brandId_fkey" FOREIGN KEY ("tenantId", "brandId") REFERENCES "brands"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_categoryId_fkey" FOREIGN KEY ("tenantId", "categoryId") REFERENCES "categories"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_taxCategoryId_fkey" FOREIGN KEY ("tenantId", "taxCategoryId") REFERENCES "tax_categories"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "products"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_tenantId_brandId_fkey" FOREIGN KEY ("tenantId", "brandId") REFERENCES "brands"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_tenantId_groupId_fkey" FOREIGN KEY ("tenantId", "groupId") REFERENCES "modifier_groups"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "products"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_tenantId_modifierGroupId_fkey" FOREIGN KEY ("tenantId", "modifierGroupId") REFERENCES "modifier_groups"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_tenantId_brandId_fkey" FOREIGN KEY ("tenantId", "brandId") REFERENCES "brands"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_schedules" ADD CONSTRAINT "menu_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_schedules" ADD CONSTRAINT "menu_schedules_tenantId_menuId_fkey" FOREIGN KEY ("tenantId", "menuId") REFERENCES "menus"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_products" ADD CONSTRAINT "menu_products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_products" ADD CONSTRAINT "menu_products_tenantId_menuId_fkey" FOREIGN KEY ("tenantId", "menuId") REFERENCES "menus"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_products" ADD CONSTRAINT "menu_products_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "products"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_combos" ADD CONSTRAINT "menu_combos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_combos" ADD CONSTRAINT "menu_combos_tenantId_menuId_fkey" FOREIGN KEY ("tenantId", "menuId") REFERENCES "menus"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_combos" ADD CONSTRAINT "menu_combos_tenantId_comboId_fkey" FOREIGN KEY ("tenantId", "comboId") REFERENCES "combos"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combos" ADD CONSTRAINT "combos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combos" ADD CONSTRAINT "combos_tenantId_brandId_fkey" FOREIGN KEY ("tenantId", "brandId") REFERENCES "brands"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combos" ADD CONSTRAINT "combos_tenantId_taxCategoryId_fkey" FOREIGN KEY ("tenantId", "taxCategoryId") REFERENCES "tax_categories"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_slots" ADD CONSTRAINT "combo_slots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_slots" ADD CONSTRAINT "combo_slots_tenantId_comboId_fkey" FOREIGN KEY ("tenantId", "comboId") REFERENCES "combos"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_slot_options" ADD CONSTRAINT "combo_slot_options_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_slot_options" ADD CONSTRAINT "combo_slot_options_tenantId_slotId_fkey" FOREIGN KEY ("tenantId", "slotId") REFERENCES "combo_slots"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_slot_options" ADD CONSTRAINT "combo_slot_options_tenantId_variantId_fkey" FOREIGN KEY ("tenantId", "variantId") REFERENCES "product_variants"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_tenantId_variantId_fkey" FOREIGN KEY ("tenantId", "variantId") REFERENCES "product_variants"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_tenantId_modifierOptionId_fkey" FOREIGN KEY ("tenantId", "modifierOptionId") REFERENCES "modifier_options"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_tenantId_comboId_fkey" FOREIGN KEY ("tenantId", "comboId") REFERENCES "combos"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_tenantId_comboSlotOptionId_fkey" FOREIGN KEY ("tenantId", "comboSlotOptionId") REFERENCES "combo_slot_options"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_tenantId_priceBookId_fkey" FOREIGN KEY ("tenantId", "priceBookId") REFERENCES "price_books"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_availability" ADD CONSTRAINT "location_availability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_availability" ADD CONSTRAINT "location_availability_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_availability" ADD CONSTRAINT "location_availability_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "products"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_availability" ADD CONSTRAINT "location_availability_tenantId_comboId_fkey" FOREIGN KEY ("tenantId", "comboId") REFERENCES "combos"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_availability" ADD CONSTRAINT "location_availability_tenantId_modifierOptionId_fkey" FOREIGN KEY ("tenantId", "modifierOptionId") REFERENCES "modifier_options"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Hand-written additions (Prisma cannot express these)
-- ============================================================================

-- 1) Partial unique indexes: names are unique per brand among NOT archived rows.
CREATE UNIQUE INDEX "uq_categories_brand_name"      ON "categories"      ("tenantId", "brandId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_products_brand_name"        ON "products"        ("tenantId", "brandId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_products_tenant_sku"        ON "products"        ("tenantId", lower("sku")) WHERE "sku" IS NOT NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_modifier_groups_brand_name" ON "modifier_groups" ("tenantId", "brandId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_menus_brand_name"           ON "menus"           ("tenantId", "brandId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_combos_brand_name"          ON "combos"          ("tenantId", "brandId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_variants_product_name"      ON "product_variants" ("tenantId", "productId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_variants_one_default"       ON "product_variants" ("tenantId", "productId") WHERE "isDefault" AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "uq_menus_one_default"          ON "menus"           ("tenantId", "brandId") WHERE "isDefault" AND "deletedAt" IS NULL;

-- One price per target + scope + channel. COALESCE folds the four nullable targets (and the two scopes)
-- into one value; ids are UUIDs so a target can never collide with a scope.
CREATE UNIQUE INDEX "uq_prices_no_channel" ON "prices" (  "tenantId",  COALESCE("variantId", "modifierOptionId", "comboId", "comboSlotOptionId"),  COALESCE("priceBookId", "locationId")) WHERE "channel" IS NULL;CREATE UNIQUE INDEX "uq_prices_with_channel" ON "prices" (  "tenantId",  COALESCE("variantId", "modifierOptionId", "comboId", "comboSlotOptionId"),  COALESCE("priceBookId", "locationId"),  "channel") WHERE "channel" IS NOT NULL;

-- One availability row per branch and target.
CREATE UNIQUE INDEX "uq_availability_product"  ON "location_availability" ("tenantId", "locationId", "productId")        WHERE "productId" IS NOT NULL;
CREATE UNIQUE INDEX "uq_availability_combo"    ON "location_availability" ("tenantId", "locationId", "comboId")          WHERE "comboId" IS NOT NULL;
CREATE UNIQUE INDEX "uq_availability_modifier" ON "location_availability" ("tenantId", "locationId", "modifierOptionId") WHERE "modifierOptionId" IS NOT NULL;

-- 2) CHECK constraints: rules the database enforces even if application code has a bug.
ALTER TABLE "prices" ADD CONSTRAINT "ck_prices_one_target"  CHECK (num_nonnulls("variantId", "modifierOptionId", "comboId", "comboSlotOptionId") = 1);
ALTER TABLE "prices" ADD CONSTRAINT "ck_prices_one_scope"   CHECK (num_nonnulls("priceBookId", "locationId") = 1);
ALTER TABLE "prices" ADD CONSTRAINT "ck_prices_amount"      CHECK ("amountMinor" >= 0 AND ("compareAtMinor" IS NULL OR "compareAtMinor" > 0));
ALTER TABLE "location_availability" ADD CONSTRAINT "ck_availability_one_target" CHECK (num_nonnulls("productId", "comboId", "modifierOptionId") = 1);
ALTER TABLE "modifier_groups" ADD CONSTRAINT "ck_modifier_groups_select" CHECK ("minSelect" >= 0 AND "maxSelect" >= 1 AND "minSelect" <= "maxSelect");
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "ck_pmg_override" CHECK (("minSelectOverride" IS NULL OR "minSelectOverride" >= 0) AND ("maxSelectOverride" IS NULL OR "maxSelectOverride" >= 1) AND ("minSelectOverride" IS NULL OR "maxSelectOverride" IS NULL OR "minSelectOverride" <= "maxSelectOverride"));
ALTER TABLE "combo_slots" ADD CONSTRAINT "ck_combo_slots_quantity" CHECK ("quantity" >= 1);
ALTER TABLE "menu_schedules" ADD CONSTRAINT "ck_menu_schedules_days"  CHECK (cardinality("weekdays") BETWEEN 1 AND 7 AND "weekdays" <@ ARRAY[0,1,2,3,4,5,6]);
ALTER TABLE "menu_schedules" ADD CONSTRAINT "ck_menu_schedules_times" CHECK (
  ("startsAt" IS NULL AND "endsAt" IS NULL)
  OR ("startsAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endsAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
