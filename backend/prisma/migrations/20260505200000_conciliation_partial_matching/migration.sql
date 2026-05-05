-- #9: suport per conciliacions parcials (mateix mov bancari ↔ múltiples factures, o factura pagada en parts).
-- `appliedAmount` és l'import d'aquesta factura cobert per aquest moviment bancari.
-- Si null, s'assumeix que cobreix `totalAmount` sencer (compatibilitat enrere).
ALTER TABLE "conciliations"
  ADD COLUMN "appliedAmount" DECIMAL(12, 2);

-- #24: visibilitat dels errors de comptabilització bancària.
-- Quan tryPostFromConciliation falla silenciosament (e.g. factura encara no
-- POSTED, falten counterparties), guardem l'error aquí perquè la UI el vegi.
ALTER TABLE "bank_movements"
  ADD COLUMN "lastPostError" TEXT,
  ADD COLUMN "lastPostAttemptAt" TIMESTAMPTZ;
