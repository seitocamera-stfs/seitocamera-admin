-- AlterTable: Vincular conductor amb usuari Seito
ALTER TABLE "conductors" ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "conductors_userId_key" ON "conductors"("userId");
ALTER TABLE "conductors" ADD CONSTRAINT "conductors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum: Afegir TRANSPORT a AbsenceType
ALTER TYPE "AbsenceType" ADD VALUE 'TRANSPORT';

-- AlterTable: Camps absència parcial i referència transport
ALTER TABLE "staff_absences" ADD COLUMN "isPartial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "staff_absences" ADD COLUMN "startTime" TEXT;
ALTER TABLE "staff_absences" ADD COLUMN "endTime" TEXT;
ALTER TABLE "staff_absences" ADD COLUMN "transportId" TEXT;
CREATE INDEX "staff_absences_transportId_idx" ON "staff_absences"("transportId");
