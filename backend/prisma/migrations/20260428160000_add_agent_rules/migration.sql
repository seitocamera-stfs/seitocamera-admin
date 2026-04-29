-- CreateEnum (IF NOT EXISTS per evitar error si ja existeix)
DO $$ BEGIN
  CREATE TYPE "AgentRuleCategory" AS ENUM ('INVOICES', 'CLASSIFICATION', 'CONCILIATION', 'SUPPLIERS', 'ANOMALIES', 'FISCAL', 'GENERAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgentRuleSource" AS ENUM ('MANUAL', 'LEARNED', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_rules" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "category" "AgentRuleCategory" NOT NULL DEFAULT 'GENERAL',
    "source" "AgentRuleSource" NOT NULL DEFAULT 'MANUAL',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "examples" TEXT,
    "createdById" TEXT,
    "timesApplied" INTEGER NOT NULL DEFAULT 0,
    "lastAppliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_rules_category_idx" ON "agent_rules"("category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_rules_isActive_idx" ON "agent_rules"("isActive");

-- AddForeignKey (ignorar si ja existeix)
DO $$ BEGIN
  ALTER TABLE "agent_rules" ADD CONSTRAINT "agent_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
