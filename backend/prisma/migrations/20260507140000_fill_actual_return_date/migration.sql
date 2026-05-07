-- Per a projectes ja marcats com RETURNED o CLOSED però sense actualReturnDate,
-- omplim el camp amb el returnDate planificat. Així el dashboard no els
-- mostra com a "devolució endarrerida" només perquè no té marca explícita.

UPDATE rental_projects
SET "actualReturnDate" = "returnDate"
WHERE "actualReturnDate" IS NULL
  AND status IN ('RETURNED', 'CLOSED')
  AND "returnDate" IS NOT NULL;
