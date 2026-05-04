-- Vincle Transport ↔ RentalProject
-- Afegeix FK opcional rentalProjectId al model Transport.
-- El camp `projecte` text es manté com a fallback per compatibilitat amb
-- transports antics que no tenen vinculació.

ALTER TABLE "transports" ADD COLUMN IF NOT EXISTS "rentalProjectId" TEXT;

CREATE INDEX IF NOT EXISTS "transports_rentalProjectId_idx" ON "transports"("rentalProjectId");

ALTER TABLE "transports" ADD CONSTRAINT "transports_rentalProjectId_fkey"
    FOREIGN KEY ("rentalProjectId") REFERENCES "rental_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
