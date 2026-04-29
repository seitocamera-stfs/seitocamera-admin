-- AlterTable: afegir responsable de devolució
ALTER TABLE "rental_projects" ADD COLUMN "returnLeadUserId" TEXT;

-- AddForeignKey
ALTER TABLE "rental_projects" ADD CONSTRAINT "rental_projects_returnLeadUserId_fkey" FOREIGN KEY ("returnLeadUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
