-- Soft delete: paperera per factures rebudes
ALTER TABLE "received_invoices" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Índex per filtrar ràpidament les no eliminades
CREATE INDEX "received_invoices_deletedAt_idx" ON "received_invoices"("deletedAt");

-- Nou estat AMOUNT_PENDING per factures sense import detectat
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'AMOUNT_PENDING';
