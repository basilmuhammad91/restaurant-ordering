-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('ASSIGNED', 'PICKED_UP', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "feeMinor" INTEGER NOT NULL DEFAULT 0,
    "minOrderMinor" INTEGER NOT NULL DEFAULT 0,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 45,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "vehicle" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "riders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_assignments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "riderId" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedById" UUID,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedUpAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "failedReason" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID,
    "userId" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "position" TEXT,
    "hourlyRateMinor" INTEGER,
    "startDate" DATE,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_shifts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "shiftDate" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "position" TEXT,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roster_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "clockInAt" TIMESTAMPTZ(3) NOT NULL,
    "clockOutAt" TIMESTAMPTZ(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" UUID,
    "adjustedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_templates" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "headerText" TEXT,
    "footerText" TEXT,
    "showTaxBreakdown" BOOLEAN NOT NULL DEFAULT true,
    "showCustomer" BOOLEAN NOT NULL DEFAULT true,
    "showCashier" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "receipt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_zones_tenantId_locationId_idx" ON "delivery_zones"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zones_tenantId_id_key" ON "delivery_zones"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "riders_tenantId_id_key" ON "riders"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_assignments_orderId_key" ON "delivery_assignments"("orderId");

-- CreateIndex
CREATE INDEX "delivery_assignments_tenantId_locationId_status_idx" ON "delivery_assignments"("tenantId", "locationId", "status");

-- CreateIndex
CREATE INDEX "employees_tenantId_name_idx" ON "employees"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenantId_id_key" ON "employees"("tenantId", "id");

-- CreateIndex
CREATE INDEX "roster_shifts_tenantId_locationId_shiftDate_idx" ON "roster_shifts"("tenantId", "locationId", "shiftDate");

-- CreateIndex
CREATE INDEX "roster_shifts_tenantId_employeeId_shiftDate_idx" ON "roster_shifts"("tenantId", "employeeId", "shiftDate");

-- CreateIndex
CREATE INDEX "time_entries_tenantId_locationId_clockInAt_idx" ON "time_entries"("tenantId", "locationId", "clockInAt");

-- CreateIndex
CREATE INDEX "time_entries_tenantId_employeeId_clockInAt_idx" ON "time_entries"("tenantId", "employeeId", "clockInAt");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_templates_tenantId_key" ON "receipt_templates"("tenantId");

-- AddForeignKey
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_tenantId_riderId_fkey" FOREIGN KEY ("tenantId", "riderId") REFERENCES "riders"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "employees"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenantId_locationId_fkey" FOREIGN KEY ("tenantId", "locationId") REFERENCES "locations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "employees"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_templates" ADD CONSTRAINT "receipt_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_amounts" CHECK ("feeMinor" >= 0 AND "minOrderMinor" >= 0 AND "estimatedMinutes" >= 0);
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_order" CHECK ("clockOutAt" IS NULL OR "clockOutAt" >= "clockInAt");
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_break" CHECK ("breakMinutes" >= 0);
-- A person can only be clocked in once at a time.
CREATE UNIQUE INDEX "time_entries_one_open" ON "time_entries" ("employeeId") WHERE "clockOutAt" IS NULL;
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_times" CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
