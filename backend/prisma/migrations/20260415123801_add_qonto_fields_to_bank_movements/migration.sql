/*
  Warnings:

  - A unique constraint covering the columns `[qontoSlug]` on the table `bank_movements` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "bank_movements" ADD COLUMN     "accountName" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "counterparty" TEXT,
ADD COLUMN     "operationType" TEXT,
ADD COLUMN     "qontoSlug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bank_movements_qontoSlug_key" ON "bank_movements"("qontoSlug");

-- CreateIndex
CREATE INDEX "bank_movements_accountName_idx" ON "bank_movements"("accountName");
