-- CreateEnum
CREATE TYPE "BankSyncType" AS ENUM ('MANUAL', 'CSV', 'QONTO', 'OPEN_BANKING');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iban" TEXT,
    "bankEntity" TEXT,
    "syncType" "BankSyncType" NOT NULL DEFAULT 'MANUAL',
    "color" TEXT NOT NULL DEFAULT '#2390A0',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- AlterTable: afegir FK a bank_movements
ALTER TABLE "bank_movements" ADD COLUMN "bankAccountId" TEXT;

-- CreateIndex
CREATE INDEX "bank_movements_bankAccountId_idx" ON "bank_movements"("bankAccountId");

-- AddForeignKey
ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: crear compte Qonto per defecte i assignar tots els moviments existents
INSERT INTO "bank_accounts" ("id", "name", "bankEntity", "syncType", "color", "isActive", "isDefault", "updatedAt")
VALUES ('qonto-default', 'Qonto Principal', 'Qonto', 'QONTO', '#6C5CE7', true, true, NOW());

UPDATE "bank_movements" SET "bankAccountId" = 'qonto-default' WHERE "bankAccountId" IS NULL;
