-- Factures compartides SEITO-LOGISTIK
ALTER TABLE "received_invoices" ADD COLUMN "isShared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "received_invoices" ADD COLUMN "sharedPercentSeito" DECIMAL(5,2) NOT NULL DEFAULT 50;
ALTER TABLE "received_invoices" ADD COLUMN "sharedPercentLogistik" DECIMAL(5,2) NOT NULL DEFAULT 50;

-- Index per filtrar ràpidament les compartides
CREATE INDEX "received_invoices_isShared_idx" ON "received_invoices"("isShared");

-- Proveïdors: marcar com compartit per defecte
ALTER TABLE "suppliers" ADD COLUMN "isSharedDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "suppliers" ADD COLUMN "sharedPercentSeito" DECIMAL(5,2) NOT NULL DEFAULT 50;
ALTER TABLE "suppliers" ADD COLUMN "sharedPercentLogistik" DECIMAL(5,2) NOT NULL DEFAULT 50;
