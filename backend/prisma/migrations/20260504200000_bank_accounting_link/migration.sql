-- Sprint 4 — Vincle entre banc i comptabilitat formal
-- Afegeix:
--   BankAccount   → accountId (FK al subcompte 572xxxx que el representa)
--   BankMovement  → companyId, accountId (subcompte 572xxxx del moviment),
--                   journalEntryId, postedAt
--
-- Tots els camps NULLable. Els subcomptes 572xxxx ja existents (creats per
-- generateCounterpartyAccounts.js) es vinculen via script complementari.

-- ============================================
-- BankAccount
-- ============================================
ALTER TABLE "bank_accounts"
    ADD COLUMN IF NOT EXISTS "accountId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "bank_accounts_accountId_key" ON "bank_accounts"("accountId");

ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- BankMovement
-- ============================================
ALTER TABLE "bank_movements"
    ADD COLUMN IF NOT EXISTS "companyId" TEXT,
    ADD COLUMN IF NOT EXISTS "accountId" TEXT,
    ADD COLUMN IF NOT EXISTS "journalEntryId" TEXT,
    ADD COLUMN IF NOT EXISTS "postedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "bank_movements_journalEntryId_key" ON "bank_movements"("journalEntryId");
CREATE INDEX IF NOT EXISTS "bank_movements_companyId_idx" ON "bank_movements"("companyId");
CREATE INDEX IF NOT EXISTS "bank_movements_postedAt_idx" ON "bank_movements"("postedAt");

ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
