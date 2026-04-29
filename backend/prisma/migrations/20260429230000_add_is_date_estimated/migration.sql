-- AlterTable: afegir camp isDateEstimated a ReceivedInvoice
-- Indica si la data de la factura és un fallback (data de pujada) o real (extreta del PDF)
DO $$ BEGIN
  ALTER TABLE "received_invoices" ADD COLUMN "isDateEstimated" BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

-- Marcar com estimades les factures existents que tenen data sospitosa
-- (factures amb source GDRIVE_SYNC o ZOHO que tenen issueDate = createdAt ± 5 min)
UPDATE "received_invoices"
SET "isDateEstimated" = true
WHERE "source" IN ('GDRIVE_SYNC', 'ZOHO')
  AND ABS(EXTRACT(EPOCH FROM ("issueDate" - "createdAt"))) < 300;
