-- Enums control horari
DO $$ BEGIN
  CREATE TYPE "TimeEntryType" AS ENUM ('OFICINA', 'RODATGE', 'TRANSPORT_ENTREGA', 'TRANSPORT_RECOLLIDA', 'TRANSPORT_COMPLET');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ShootingRole" AS ENUM ('VIDEOASSIST', 'AUX_CAMERA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OvertimeStatus" AS ENUM ('PENDENT', 'APROVADA', 'REBUTJADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Taula control horari
CREATE TABLE IF NOT EXISTS "time_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "type" "TimeEntryType" NOT NULL DEFAULT 'OFICINA',
    "shootingRole" "ShootingRole",
    "projectName" TEXT,
    "notes" TEXT,
    "totalMinutes" INTEGER,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeStatus" "OvertimeStatus" NOT NULL DEFAULT 'PENDENT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- Índexs
CREATE INDEX IF NOT EXISTS "time_entries_userId_idx" ON "time_entries"("userId");
CREATE INDEX IF NOT EXISTS "time_entries_date_idx" ON "time_entries"("date");
CREATE INDEX IF NOT EXISTS "time_entries_userId_date_idx" ON "time_entries"("userId", "date");
CREATE INDEX IF NOT EXISTS "time_entries_overtimeStatus_idx" ON "time_entries"("overtimeStatus");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
