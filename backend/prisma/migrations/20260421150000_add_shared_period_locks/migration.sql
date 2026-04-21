-- CreateTable
CREATE TABLE "shared_period_locks" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "compensated" BOOLEAN NOT NULL DEFAULT false,
    "compensatedAt" TIMESTAMP(3),
    "compensatedBy" TEXT,
    "compensatedDirection" TEXT,
    "compensatedAmount" DECIMAL(12,2),
    "balanceSeito" DECIMAL(12,2),
    "balanceLogistik" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_period_locks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shared_period_locks_year_period_periodType_key" ON "shared_period_locks"("year", "period", "periodType");

-- AddForeignKey
ALTER TABLE "shared_period_locks" ADD CONSTRAINT "shared_period_locks_lockedBy_fkey" FOREIGN KEY ("lockedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_period_locks" ADD CONSTRAINT "shared_period_locks_compensatedBy_fkey" FOREIGN KEY ("compensatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
