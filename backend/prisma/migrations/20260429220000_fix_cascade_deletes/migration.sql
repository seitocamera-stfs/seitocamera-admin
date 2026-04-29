-- Fix: Afegir ON DELETE CASCADE a conciliations i agent_suggestions
-- Sense això, eliminar una factura o moviment bancari dona FK error

-- Conciliation → BankMovement
ALTER TABLE "conciliations" DROP CONSTRAINT IF EXISTS "conciliations_bankMovementId_fkey";
ALTER TABLE "conciliations" ADD CONSTRAINT "conciliations_bankMovementId_fkey"
  FOREIGN KEY ("bankMovementId") REFERENCES "bank_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Conciliation → ReceivedInvoice
ALTER TABLE "conciliations" DROP CONSTRAINT IF EXISTS "conciliations_receivedInvoiceId_fkey";
ALTER TABLE "conciliations" ADD CONSTRAINT "conciliations_receivedInvoiceId_fkey"
  FOREIGN KEY ("receivedInvoiceId") REFERENCES "received_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Conciliation → IssuedInvoice
ALTER TABLE "conciliations" DROP CONSTRAINT IF EXISTS "conciliations_issuedInvoiceId_fkey";
ALTER TABLE "conciliations" ADD CONSTRAINT "conciliations_issuedInvoiceId_fkey"
  FOREIGN KEY ("issuedInvoiceId") REFERENCES "issued_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AgentSuggestion → ReceivedInvoice
ALTER TABLE "agent_suggestions" DROP CONSTRAINT IF EXISTS "agent_suggestions_receivedInvoiceId_fkey";
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_receivedInvoiceId_fkey"
  FOREIGN KEY ("receivedInvoiceId") REFERENCES "received_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
