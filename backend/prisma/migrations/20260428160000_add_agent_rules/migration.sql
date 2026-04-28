-- CreateEnum
CREATE TYPE "AgentRuleCategory" AS ENUM ('INVOICES', 'CLASSIFICATION', 'CONCILIATION', 'SUPPLIERS', 'ANOMALIES', 'FISCAL', 'GENERAL');

-- CreateEnum
CREATE TYPE "AgentRuleSource" AS ENUM ('MANUAL', 'LEARNED', 'SYSTEM');

-- CreateTable
CREATE TABLE "agent_rules" (
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
CREATE INDEX "agent_rules_category_idx" ON "agent_rules"("category");

-- CreateIndex
CREATE INDEX "agent_rules_isActive_idx" ON "agent_rules"("isActive");

-- AddForeignKey
ALTER TABLE "agent_rules" ADD CONSTRAINT "agent_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
