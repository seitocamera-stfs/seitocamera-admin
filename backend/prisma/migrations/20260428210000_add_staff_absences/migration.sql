-- Enums per absències
DO $$ BEGIN
  CREATE TYPE "AbsenceType" AS ENUM ('VACANCES', 'MALALTIA', 'RODATGE', 'PERMIS', 'FORMACIO', 'ALTRE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AbsenceStatus" AS ENUM ('PENDENT', 'APROVADA', 'REBUTJADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Taula d'absències de personal
CREATE TABLE IF NOT EXISTS "staff_absences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "approvedById" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "type" "AbsenceType" NOT NULL,
    "status" "AbsenceStatus" NOT NULL DEFAULT 'PENDENT',
    "notes" TEXT,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_absences_pkey" PRIMARY KEY ("id")
);

-- Índexs
CREATE INDEX IF NOT EXISTS "staff_absences_userId_idx" ON "staff_absences"("userId");
CREATE INDEX IF NOT EXISTS "staff_absences_startDate_endDate_idx" ON "staff_absences"("startDate", "endDate");
CREATE INDEX IF NOT EXISTS "staff_absences_status_idx" ON "staff_absences"("status");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "staff_absences" ADD CONSTRAINT "staff_absences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "staff_absences" ADD CONSTRAINT "staff_absences_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
