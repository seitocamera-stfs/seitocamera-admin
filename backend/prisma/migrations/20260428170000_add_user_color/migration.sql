-- AlterTable (idempotent)
DO $$ BEGIN
  ALTER TABLE "users" ADD COLUMN "color" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
