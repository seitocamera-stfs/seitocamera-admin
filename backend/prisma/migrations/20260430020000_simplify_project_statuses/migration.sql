-- Migrar projectes amb estats eliminats als nous estats equivalents
UPDATE "rental_projects" SET "status" = 'IN_PREPARATION' WHERE "status" IN ('PENDING_TECH_REVIEW', 'PENDING_FINAL_CHECK');
UPDATE "rental_projects" SET "status" = 'READY' WHERE "status" = 'PENDING_LOAD';
UPDATE "rental_projects" SET "status" = 'RETURNED' WHERE "status" IN ('RETURN_REVIEW', 'WITH_INCIDENT', 'EQUIPMENT_BLOCKED');

-- Migrar status_changes history
UPDATE "project_status_changes" SET "fromStatus" = 'IN_PREPARATION' WHERE "fromStatus" IN ('PENDING_TECH_REVIEW', 'PENDING_FINAL_CHECK');
UPDATE "project_status_changes" SET "toStatus" = 'IN_PREPARATION' WHERE "toStatus" IN ('PENDING_TECH_REVIEW', 'PENDING_FINAL_CHECK');
UPDATE "project_status_changes" SET "fromStatus" = 'READY' WHERE "fromStatus" = 'PENDING_LOAD';
UPDATE "project_status_changes" SET "toStatus" = 'READY' WHERE "toStatus" = 'PENDING_LOAD';
UPDATE "project_status_changes" SET "fromStatus" = 'RETURNED' WHERE "fromStatus" IN ('RETURN_REVIEW', 'WITH_INCIDENT', 'EQUIPMENT_BLOCKED');
UPDATE "project_status_changes" SET "toStatus" = 'RETURNED' WHERE "toStatus" IN ('RETURN_REVIEW', 'WITH_INCIDENT', 'EQUIPMENT_BLOCKED');

-- Eliminar valors de l'enum (PostgreSQL requereix recrear l'enum)
ALTER TYPE "ProjectStatus" RENAME TO "ProjectStatus_old";
CREATE TYPE "ProjectStatus" AS ENUM ('PENDING_PREP', 'IN_PREPARATION', 'READY', 'OUT', 'RETURNED', 'CLOSED');
ALTER TABLE "rental_projects" ALTER COLUMN "status" TYPE "ProjectStatus" USING "status"::text::"ProjectStatus";
ALTER TABLE "project_status_changes" ALTER COLUMN "fromStatus" TYPE "ProjectStatus" USING "fromStatus"::text::"ProjectStatus";
ALTER TABLE "project_status_changes" ALTER COLUMN "toStatus" TYPE "ProjectStatus" USING "toStatus"::text::"ProjectStatus";
DROP TYPE "ProjectStatus_old";
