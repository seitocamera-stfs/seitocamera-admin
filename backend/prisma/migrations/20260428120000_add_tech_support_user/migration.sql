-- Afegir camp tècnic de suport al projecte
ALTER TABLE "rental_projects" ADD COLUMN "techSupportUserId" TEXT;

-- Foreign key
ALTER TABLE "rental_projects" ADD CONSTRAINT "rental_projects_techSupportUserId_fkey"
  FOREIGN KEY ("techSupportUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
