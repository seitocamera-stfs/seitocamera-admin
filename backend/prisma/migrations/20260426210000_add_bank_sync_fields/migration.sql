-- AlterTable: Afegir camps de sincronització a bank_accounts
ALTER TABLE "bank_accounts" ADD COLUMN "syncConfig" JSONB;
ALTER TABLE "bank_accounts" ADD COLUMN "currentBalance" DECIMAL(12,2);
ALTER TABLE "bank_accounts" ADD COLUMN "lastSyncAt" TIMESTAMP(3);
ALTER TABLE "bank_accounts" ADD COLUMN "lastSyncError" TEXT;
