-- Data tall a partir de la qual el sistema considera comptablement una factura.
-- Tot el que té issueDate < accountingScopeFrom queda fora del scope:
--   - Cap suggeriment IA es genera (classify/anomalies/duplicates/etc.)
--   - No apareix a "Cobraments vençuts" del CEO IA
--   - No surt al Dashboard com a alerta
-- Per defecte = inici de l'exercici en curs (1 gener de l'any actual).
ALTER TABLE "companies"
  ADD COLUMN "accountingScopeFrom" TIMESTAMPTZ;
