-- Sprint 3 — Vincle entre factures i comptabilitat formal
-- Afegeix:
--   ReceivedInvoice / IssuedInvoice  → companyId, accountId, counterpartyAccountId, journalEntryId, postedAt
--   Supplier                         → defaultExpenseAccountId, counterpartyAccountId
--   Client                           → defaultRevenueAccountId, counterpartyAccountId
--
-- Tots els camps són NULLable per no trencar registres històrics.
-- El camp `pgcAccount` (text) es manté com a legacy fins al Sprint 5.
-- La regla d'exclusió ("factures pujades a Compartides") usa el camp existent
-- `origin = 'LOGISTIK'` (ja s'aplica al gdriveSyncJob), no cal flag nou.

-- ============================================
-- ReceivedInvoice
-- ============================================

ALTER TABLE "received_invoices"
    ADD COLUMN IF NOT EXISTS "companyId" TEXT,
    ADD COLUMN IF NOT EXISTS "accountId" TEXT,
    ADD COLUMN IF NOT EXISTS "counterpartyAccountId" TEXT,
    ADD COLUMN IF NOT EXISTS "journalEntryId" TEXT,
    ADD COLUMN IF NOT EXISTS "postedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "received_invoices_journalEntryId_key" ON "received_invoices"("journalEntryId");
CREATE INDEX IF NOT EXISTS "received_invoices_companyId_idx" ON "received_invoices"("companyId");
CREATE INDEX IF NOT EXISTS "received_invoices_accountId_idx" ON "received_invoices"("accountId");
CREATE INDEX IF NOT EXISTS "received_invoices_postedAt_idx" ON "received_invoices"("postedAt");

ALTER TABLE "received_invoices" ADD CONSTRAINT "received_invoices_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "received_invoices" ADD CONSTRAINT "received_invoices_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "received_invoices" ADD CONSTRAINT "received_invoices_counterpartyAccountId_fkey"
    FOREIGN KEY ("counterpartyAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "received_invoices" ADD CONSTRAINT "received_invoices_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- IssuedInvoice
-- ============================================

ALTER TABLE "issued_invoices"
    ADD COLUMN IF NOT EXISTS "companyId" TEXT,
    ADD COLUMN IF NOT EXISTS "accountId" TEXT,
    ADD COLUMN IF NOT EXISTS "counterpartyAccountId" TEXT,
    ADD COLUMN IF NOT EXISTS "journalEntryId" TEXT,
    ADD COLUMN IF NOT EXISTS "postedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "issued_invoices_journalEntryId_key" ON "issued_invoices"("journalEntryId");
CREATE INDEX IF NOT EXISTS "issued_invoices_companyId_idx" ON "issued_invoices"("companyId");
CREATE INDEX IF NOT EXISTS "issued_invoices_accountId_idx" ON "issued_invoices"("accountId");
CREATE INDEX IF NOT EXISTS "issued_invoices_postedAt_idx" ON "issued_invoices"("postedAt");

ALTER TABLE "issued_invoices" ADD CONSTRAINT "issued_invoices_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "issued_invoices" ADD CONSTRAINT "issued_invoices_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "issued_invoices" ADD CONSTRAINT "issued_invoices_counterpartyAccountId_fkey"
    FOREIGN KEY ("counterpartyAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "issued_invoices" ADD CONSTRAINT "issued_invoices_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- Supplier
-- ============================================

ALTER TABLE "suppliers"
    ADD COLUMN IF NOT EXISTS "defaultExpenseAccountId" TEXT,
    ADD COLUMN IF NOT EXISTS "counterpartyAccountId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_counterpartyAccountId_key" ON "suppliers"("counterpartyAccountId");
CREATE INDEX IF NOT EXISTS "suppliers_defaultExpenseAccountId_idx" ON "suppliers"("defaultExpenseAccountId");

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_defaultExpenseAccountId_fkey"
    FOREIGN KEY ("defaultExpenseAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_counterpartyAccountId_fkey"
    FOREIGN KEY ("counterpartyAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- Client
-- ============================================

ALTER TABLE "clients"
    ADD COLUMN IF NOT EXISTS "defaultRevenueAccountId" TEXT,
    ADD COLUMN IF NOT EXISTS "counterpartyAccountId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "clients_counterpartyAccountId_key" ON "clients"("counterpartyAccountId");
CREATE INDEX IF NOT EXISTS "clients_defaultRevenueAccountId_idx" ON "clients"("defaultRevenueAccountId");

ALTER TABLE "clients" ADD CONSTRAINT "clients_defaultRevenueAccountId_fkey"
    FOREIGN KEY ("defaultRevenueAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "clients" ADD CONSTRAINT "clients_counterpartyAccountId_fkey"
    FOREIGN KEY ("counterpartyAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
