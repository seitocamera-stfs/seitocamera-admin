-- Sprint 6 — Immobilitzat i amortitzacions
--
-- Crea fixed_assets i amortization_entries.
-- Quan una factura rebuda es comptabilitza amb un compte del grup 2 (ASSET),
-- el invoicePostingService crea automàticament un FixedAsset i el seu calendari.

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE "FixedAssetStatus" AS ENUM ('ACTIVE', 'FULLY_AMORTIZED', 'DISPOSED');

-- ============================================
-- TAULA: fixed_assets
-- ============================================

CREATE TABLE IF NOT EXISTS "fixed_assets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "equipmentId" TEXT,
    "receivedInvoiceId" TEXT,
    "accountId" TEXT NOT NULL,
    "amortizationAccountId" TEXT NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "acquisitionValue" DECIMAL(14,2) NOT NULL,
    "residualValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "usefulLifeYears" DECIMAL(5,2) NOT NULL,
    "amortizationMethod" TEXT NOT NULL DEFAULT 'LINEAR',
    "monthlyAmortization" DECIMAL(14,2) NOT NULL,
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "disposalDate" TIMESTAMP(3),
    "disposalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fixed_assets_companyId_code_key" ON "fixed_assets"("companyId", "code");
CREATE INDEX IF NOT EXISTS "fixed_assets_equipmentId_idx" ON "fixed_assets"("equipmentId");
CREATE INDEX IF NOT EXISTS "fixed_assets_status_idx" ON "fixed_assets"("status");
CREATE INDEX IF NOT EXISTS "fixed_assets_acquisitionDate_idx" ON "fixed_assets"("acquisitionDate");

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_equipmentId_fkey"
    FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_receivedInvoiceId_fkey"
    FOREIGN KEY ("receivedInvoiceId") REFERENCES "received_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_amortizationAccountId_fkey"
    FOREIGN KEY ("amortizationAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_expenseAccountId_fkey"
    FOREIGN KEY ("expenseAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================
-- TAULA: amortization_entries
-- ============================================

CREATE TABLE IF NOT EXISTS "amortization_entries" (
    "id" TEXT NOT NULL,
    "fixedAssetId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "accumulated" DECIMAL(14,2) NOT NULL,
    "netValue" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "journalEntryId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "amortization_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "amortization_entries_fixedAssetId_year_month_key"
    ON "amortization_entries"("fixedAssetId", "year", "month");
CREATE UNIQUE INDEX IF NOT EXISTS "amortization_entries_journalEntryId_key"
    ON "amortization_entries"("journalEntryId");
CREATE INDEX IF NOT EXISTS "amortization_entries_year_month_status_idx"
    ON "amortization_entries"("year", "month", "status");

ALTER TABLE "amortization_entries" ADD CONSTRAINT "amortization_entries_fixedAssetId_fkey"
    FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "amortization_entries" ADD CONSTRAINT "amortization_entries_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
