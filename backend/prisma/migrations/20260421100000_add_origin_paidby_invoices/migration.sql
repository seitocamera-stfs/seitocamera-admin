-- Origen de la factura (SEITO = normal, LOGISTIK = pujada per Logistik, SHARED = compartida)
ALTER TABLE "received_invoices" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'SEITO';

-- Qui ha pagat la factura compartida (NONE = pendent, SEITO, LOGISTIK)
ALTER TABLE "received_invoices" ADD COLUMN "paidBy" TEXT NOT NULL DEFAULT 'NONE';

-- Índex per filtrar ràpidament per origen
CREATE INDEX "received_invoices_origin_idx" ON "received_invoices"("origin");

-- Les factures ja marcades com a compartides passen a origin SHARED
UPDATE "received_invoices" SET "origin" = 'SHARED' WHERE "isShared" = true;

-- Les factures amb status PAID es marquen com pagades per Seito per defecte
UPDATE "received_invoices" SET "paidBy" = 'SEITO' WHERE "status" = 'PAID' AND "isShared" = true;
