-- =============================================
-- Migració: Mòdul Operacions complet
-- Reconstruïda per garantir deploys nets
-- =============================================

-- ENUMS

DO $$ BEGIN
  CREATE TYPE "OperationalRole" AS ENUM ('ADMIN_COORDINATION', 'WAREHOUSE_LEAD', 'WAREHOUSE_SUPPORT', 'TECH_LEAD', 'INTERN_SUPPORT', 'GENERAL_MANAGER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ProjectStatus" AS ENUM ('PENDING_PREP', 'IN_PREPARATION', 'PENDING_TECH_REVIEW', 'PENDING_FINAL_CHECK', 'READY', 'PENDING_LOAD', 'OUT', 'RETURNED', 'RETURN_REVIEW', 'WITH_INCIDENT', 'EQUIPMENT_BLOCKED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "IncidentStatus" AS ENUM ('INC_OPEN', 'INC_IN_PROGRESS', 'INC_WAITING_PARTS', 'INC_WAITING_CLIENT', 'INC_RESOLVED', 'INC_CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OpTaskStatus" AS ENUM ('OP_PENDING', 'OP_IN_PROGRESS', 'OP_DONE', 'OP_CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PermissionLevel" AS ENUM ('NONE', 'VIEW_ONLY', 'OPERATE', 'MANAGE', 'FULL_ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- TAULES

-- Role Definitions
CREATE TABLE IF NOT EXISTS "role_definitions" (
    "id" TEXT NOT NULL,
    "code" "OperationalRole" NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "description" TEXT,
    "responsibilities" JSONB NOT NULL,
    "limitations" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT NOT NULL DEFAULT '#2390A0',
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "role_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "role_definitions_code_key" ON "role_definitions"("code");

-- Role Assignments
CREATE TABLE IF NOT EXISTS "role_assignments" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "role_assignments_roleId_userId_startDate_key" ON "role_assignments"("roleId", "userId", "startDate");
CREATE INDEX IF NOT EXISTS "role_assignments_userId_idx" ON "role_assignments"("userId");
CREATE INDEX IF NOT EXISTS "role_assignments_roleId_idx" ON "role_assignments"("roleId");

-- Role Permissions
CREATE TABLE IF NOT EXISTS "role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "level" "PermissionLevel" NOT NULL DEFAULT 'VIEW_ONLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_roleId_section_key" ON "role_permissions"("roleId", "section");

-- Rental Projects (sense camps afegits en migracions posteriors: checkDate, checkTime, shootEndDate, shootEndTime, techSupportUserId, rentmanStatus, returnLeadUserId)
CREATE TABLE IF NOT EXISTS "rental_projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientName" TEXT,
    "clientId" TEXT,
    "departureDate" TIMESTAMP(3) NOT NULL,
    "departureTime" TEXT,
    "returnDate" TIMESTAMP(3) NOT NULL,
    "returnTime" TEXT,
    "actualReturnDate" TIMESTAMP(3),
    "status" "ProjectStatus" NOT NULL DEFAULT 'PENDING_PREP',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "leadUserId" TEXT,
    "leadRoleCode" "OperationalRole",
    "transportType" TEXT,
    "transportNotes" TEXT,
    "pickupTime" TEXT,
    "warehouseValidated" BOOLEAN NOT NULL DEFAULT false,
    "warehouseValidatedBy" TEXT,
    "warehouseValidatedAt" TIMESTAMP(3),
    "techValidated" BOOLEAN NOT NULL DEFAULT false,
    "techValidatedBy" TEXT,
    "techValidatedAt" TIMESTAMP(3),
    "techValidationRequired" BOOLEAN NOT NULL DEFAULT false,
    "rentmanProjectId" TEXT,
    "budgetReference" TEXT,
    "internalNotes" TEXT,
    "clientNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rental_projects_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "rental_projects_departureDate_idx" ON "rental_projects"("departureDate");
CREATE INDEX IF NOT EXISTS "rental_projects_returnDate_idx" ON "rental_projects"("returnDate");
CREATE INDEX IF NOT EXISTS "rental_projects_status_idx" ON "rental_projects"("status");
CREATE INDEX IF NOT EXISTS "rental_projects_leadUserId_idx" ON "rental_projects"("leadUserId");
CREATE INDEX IF NOT EXISTS "rental_projects_priority_idx" ON "rental_projects"("priority");

-- Project Assignments
CREATE TABLE IF NOT EXISTS "project_assignments" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleCode" "OperationalRole" NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "project_assignments_projectId_userId_key" ON "project_assignments"("projectId", "userId");
CREATE INDEX IF NOT EXISTS "project_assignments_userId_idx" ON "project_assignments"("userId");

-- Project Status Changes
CREATE TABLE IF NOT EXISTS "project_status_changes" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromStatus" "ProjectStatus",
    "toStatus" "ProjectStatus" NOT NULL,
    "changedBy" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_status_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "project_status_changes_projectId_idx" ON "project_status_changes"("projectId");
CREATE INDEX IF NOT EXISTS "project_status_changes_createdAt_idx" ON "project_status_changes"("createdAt");

-- Project Equipment
CREATE TABLE IF NOT EXISTS "project_equipment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "equipmentId" TEXT,
    "itemName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "isCheckedOut" BOOLEAN NOT NULL DEFAULT false,
    "isReturned" BOOLEAN NOT NULL DEFAULT false,
    "returnCondition" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_equipment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "project_equipment_projectId_idx" ON "project_equipment"("projectId");
CREATE INDEX IF NOT EXISTS "project_equipment_equipmentId_idx" ON "project_equipment"("equipmentId");

-- Project Tasks (sense camps afegits en migracions posteriors: createdById, notes, category, dueTime, reminder*, recurrence*)
CREATE TABLE IF NOT EXISTS "project_tasks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedToId" TEXT,
    "completedById" TEXT,
    "status" "OpTaskStatus" NOT NULL DEFAULT 'OP_PENDING',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "requiresSupervision" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "project_tasks_projectId_idx" ON "project_tasks"("projectId");
CREATE INDEX IF NOT EXISTS "project_tasks_assignedToId_idx" ON "project_tasks"("assignedToId");

-- Incidents
CREATE TABLE IF NOT EXISTS "incidents" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "equipmentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "IncidentStatus" NOT NULL DEFAULT 'INC_OPEN',
    "reportedById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "assignedRoleCode" "OperationalRole",
    "affectsFutureDeparture" BOOLEAN NOT NULL DEFAULT false,
    "affectedProjectId" TEXT,
    "requiresClientNotification" BOOLEAN NOT NULL DEFAULT false,
    "clientNotified" BOOLEAN NOT NULL DEFAULT false,
    "equipmentBlocked" BOOLEAN NOT NULL DEFAULT false,
    "actionTaken" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "incidents_projectId_idx" ON "incidents"("projectId");
CREATE INDEX IF NOT EXISTS "incidents_equipmentId_idx" ON "incidents"("equipmentId");
CREATE INDEX IF NOT EXISTS "incidents_status_idx" ON "incidents"("status");
CREATE INDEX IF NOT EXISTS "incidents_severity_idx" ON "incidents"("severity");
CREATE INDEX IF NOT EXISTS "incidents_reportedById_idx" ON "incidents"("reportedById");

-- Daily Plans
CREATE TABLE IF NOT EXISTS "daily_plans" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "summary" TEXT,
    "availableStaff" JSONB,
    "urgentNotes" TEXT,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "daily_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "daily_plans_date_key" ON "daily_plans"("date");
CREATE INDEX IF NOT EXISTS "daily_plans_date_idx" ON "daily_plans"("date");

-- Project Communications
CREATE TABLE IF NOT EXISTS "project_communications" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "targetRoleCode" "OperationalRole",
    "message" TEXT NOT NULL,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_communications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "project_communications_projectId_idx" ON "project_communications"("projectId");
CREATE INDEX IF NOT EXISTS "project_communications_targetRoleCode_idx" ON "project_communications"("targetRoleCode");
CREATE INDEX IF NOT EXISTS "project_communications_isRead_idx" ON "project_communications"("isRead");

-- Protocols
CREATE TABLE IF NOT EXISTS "protocols" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastEditedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "protocols_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "protocols_slug_key" ON "protocols"("slug");
CREATE INDEX IF NOT EXISTS "protocols_category_idx" ON "protocols"("category");

-- FOREIGN KEYS

DO $$ BEGIN
  ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "rental_projects" ADD CONSTRAINT "rental_projects_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "rental_projects" ADD CONSTRAINT "rental_projects_leadUserId_fkey" FOREIGN KEY ("leadUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "rental_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_status_changes" ADD CONSTRAINT "project_status_changes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "rental_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_equipment" ADD CONSTRAINT "project_equipment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "rental_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_equipment" ADD CONSTRAINT "project_equipment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "rental_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "incidents" ADD CONSTRAINT "incidents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "rental_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "incidents" ADD CONSTRAINT "incidents_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_communications" ADD CONSTRAINT "project_communications_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "rental_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
