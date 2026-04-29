-- Afegir camps de dates del cicle Rentman: check, shootEnd
-- checkDate = planperiod_start (dia de preparació/check)
-- shootEndDate = usageperiod_end (fi del rodatge)
DO $$ BEGIN
  ALTER TABLE "rental_projects" ADD COLUMN "checkDate" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "rental_projects" ADD COLUMN "checkTime" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "rental_projects" ADD COLUMN "shootEndDate" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "rental_projects" ADD COLUMN "shootEndTime" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
