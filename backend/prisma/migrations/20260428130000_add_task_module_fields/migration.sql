-- =============================================
-- Migració: Mòdul de tasques complet
-- Nous enums, nous camps, projectId nullable
-- =============================================

-- 1) Afegir OP_BLOCKED a OpTaskStatus (si no existeix)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'OP_BLOCKED'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'OpTaskStatus')
  ) THEN
    ALTER TYPE "OpTaskStatus" ADD VALUE 'OP_BLOCKED';
  END IF;
END $$;

-- 2) Crear enum TaskCategory
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskCategory') THEN
    CREATE TYPE "TaskCategory" AS ENUM ('WAREHOUSE', 'TECH', 'ADMIN', 'TRANSPORT', 'GENERAL');
  END IF;
END $$;

-- 3) Crear enum TaskReminder
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskReminder') THEN
    CREATE TYPE "TaskReminder" AS ENUM ('NONE', 'AT_TIME', 'HOUR_BEFORE', 'DAY_BEFORE', 'CUSTOM');
  END IF;
END $$;

-- 4) Crear enum TaskRecurrence
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskRecurrence') THEN
    CREATE TYPE "TaskRecurrence" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');
  END IF;
END $$;

-- 5) Fer projectId nullable (pot ser que ja ho sigui, ALTER no falla)
ALTER TABLE "project_tasks" ALTER COLUMN "projectId" DROP NOT NULL;

-- 6) Afegir nous camps a project_tasks
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "category" "TaskCategory" NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "dueTime" TEXT;
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "reminder" "TaskReminder" NOT NULL DEFAULT 'NONE';
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "reminderCustom" TEXT;
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "recurrence" "TaskRecurrence" NOT NULL DEFAULT 'NONE';
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "recurrenceCustom" TEXT;
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "recurrenceEndAt" TIMESTAMP(3);

-- 7) Índex per categoria (útil per filtrar)
CREATE INDEX IF NOT EXISTS "project_tasks_category_idx" ON "project_tasks"("category");
CREATE INDEX IF NOT EXISTS "project_tasks_status_idx" ON "project_tasks"("status");
