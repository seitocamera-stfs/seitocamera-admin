-- AlterTable: Afegir paidAmount per suportar pagaments parcials
ALTER TABLE "received_invoices" ADD COLUMN "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "issued_invoices" ADD COLUMN "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Actualitzar paidAmount per factures ja pagades (PAID amb conciliació confirmada)
UPDATE "received_invoices" ri
SET "paidAmount" = ri."totalAmount"
WHERE ri."status" = 'PAID'
  AND EXISTS (
    SELECT 1 FROM "conciliations" c
    WHERE c."receivedInvoiceId" = ri."id"
      AND c."status" IN ('CONFIRMED', 'MANUAL_MATCHED')
  );

UPDATE "issued_invoices" ii
SET "paidAmount" = ii."totalAmount"
WHERE ii."status" = 'PAID'
  AND EXISTS (
    SELECT 1 FROM "conciliations" c
    WHERE c."issuedInvoiceId" = ii."id"
      AND c."status" IN ('CONFIRMED', 'MANUAL_MATCHED')
  );
