-- AlterTable
ALTER TABLE "issued_invoices"
  ADD COLUMN "projectReference" TEXT,
  ADD COLUMN "projectName" TEXT,
  ADD COLUMN "rentmanInvoiceId" TEXT,
  ADD COLUMN "rentmanProjectId" TEXT;

-- CreateIndex
CREATE INDEX "issued_invoices_rentmanInvoiceId_idx" ON "issued_invoices"("rentmanInvoiceId");
