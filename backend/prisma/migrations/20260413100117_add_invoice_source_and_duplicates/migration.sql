-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('MANUAL', 'EMAIL_WITH_PDF', 'EMAIL_NO_PDF', 'PCLOUD_SYNC', 'BANK_DETECTED');

-- AlterTable
ALTER TABLE "received_invoices" ADD COLUMN     "duplicateOfId" TEXT,
ADD COLUMN     "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pcloudPath" TEXT,
ADD COLUMN     "source" "InvoiceSource" NOT NULL DEFAULT 'MANUAL';

-- CreateIndex
CREATE INDEX "received_invoices_source_idx" ON "received_invoices"("source");
