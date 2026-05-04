-- Sprint 2 — Llibre Diari amb partida doble
-- Crea: journal_entries, journal_lines + enums associats
-- Vincle a factures/banc/immobilitzat queda diferit a sprints posteriors
-- (per ara s'usa el camp polimòrfic sourceRef).

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE "JournalEntryType" AS ENUM (
  'RECEIVED_INVOICE',
  'ISSUED_INVOICE',
  'PAYMENT',
  'COLLECTION',
  'BANK_TRANSFER',
  'BANK_FEE',
  'AMORTIZATION',
  'PAYROLL',
  'TAX_PAYMENT',
  'TAX_ACCRUAL',
  'YEAR_CLOSING',
  'YEAR_OPENING',
  'ADJUSTMENT',
  'OTHER'
);

CREATE TYPE "JournalEntrySource" AS ENUM (
  'MANUAL',
  'AUTO_INVOICE',
  'AUTO_BANK',
  'AUTO_AMORTIZATION',
  'AUTO_CLOSING',
  'AGENT'
);

CREATE TYPE "JournalEntryStatus" AS ENUM (
  'DRAFT',
  'POSTED',
  'REVERSED'
);

-- ============================================
-- TAULA: journal_entries
-- ============================================

CREATE TABLE IF NOT EXISTS "journal_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "entryNumber" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "type" "JournalEntryType" NOT NULL DEFAULT 'OTHER',
    "source" "JournalEntrySource" NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "reversedById" TEXT,
    "reversesId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_companyId_fiscalYearId_entryNumber_key"
    ON "journal_entries"("companyId", "fiscalYearId", "entryNumber");
CREATE INDEX IF NOT EXISTS "journal_entries_date_idx" ON "journal_entries"("date");
CREATE INDEX IF NOT EXISTS "journal_entries_type_idx" ON "journal_entries"("type");
CREATE INDEX IF NOT EXISTS "journal_entries_status_idx" ON "journal_entries"("status");
CREATE INDEX IF NOT EXISTS "journal_entries_fiscalYearId_date_idx" ON "journal_entries"("fiscalYearId", "date");
CREATE INDEX IF NOT EXISTS "journal_entries_sourceRef_idx" ON "journal_entries"("sourceRef");

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscalYearId_fkey"
    FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_postedById_fkey"
    FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversedById_fkey"
    FOREIGN KEY ("reversedById") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversesId_fkey"
    FOREIGN KEY ("reversesId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- TAULA: journal_lines
-- ============================================

CREATE TABLE IF NOT EXISTS "journal_lines" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "counterpartyId" TEXT,
    "counterpartyType" TEXT,
    "projectId" TEXT,
    "vatRate" DECIMAL(5,2),
    "vatBase" DECIMAL(14,2),
    "irpfRate" DECIMAL(5,2),
    "irpfBase" DECIMAL(14,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "journal_lines_journalEntryId_idx" ON "journal_lines"("journalEntryId");
CREATE INDEX IF NOT EXISTS "journal_lines_accountId_idx" ON "journal_lines"("accountId");
CREATE INDEX IF NOT EXISTS "journal_lines_projectId_idx" ON "journal_lines"("projectId");

ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "rental_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defensa addicional: una línia no pot tenir alhora deure i haver positius
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_xor_debit_credit"
    CHECK ((("debit" > 0 AND "credit" = 0) OR ("debit" = 0 AND "credit" > 0) OR ("debit" = 0 AND "credit" = 0)));
