-- Afegir camps de dates del cicle Rentman: check, shootEnd
-- checkDate = planperiod_start (dia de preparació/check)
-- shootEndDate = usageperiod_end (fi del rodatge)
ALTER TABLE "rental_projects" ADD COLUMN "checkDate" TIMESTAMP(3);
ALTER TABLE "rental_projects" ADD COLUMN "checkTime" TEXT;
ALTER TABLE "rental_projects" ADD COLUMN "shootEndDate" TIMESTAMP(3);
ALTER TABLE "rental_projects" ADD COLUMN "shootEndTime" TEXT;
