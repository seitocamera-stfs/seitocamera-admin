-- AlterTable: afegir camp rentmanStatus a rental_projects (idempotent)
DO $$ BEGIN
  ALTER TABLE "rental_projects" ADD COLUMN "rentmanStatus" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
