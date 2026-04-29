-- AlterTable: afegir responsable de devolució (idempotent)
DO $$ BEGIN
  ALTER TABLE "rental_projects" ADD COLUMN "returnLeadUserId" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "rental_projects" ADD CONSTRAINT "rental_projects_returnLeadUserId_fkey" FOREIGN KEY ("returnLeadUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
