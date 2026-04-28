-- AlterEnum: afegir CONCILIATION_MATCH a SuggestionType
ALTER TYPE "SuggestionType" ADD VALUE IF NOT EXISTS 'CONCILIATION_MATCH';

-- CreateTable: agent_jobs
CREATE TABLE "agent_jobs" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "details" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: agent_job_configs
CREATE TABLE "agent_job_configs" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cronSchedule" TEXT NOT NULL DEFAULT '0 */2 * * *',
    "lastRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_job_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_jobs_jobType_idx" ON "agent_jobs"("jobType");
CREATE INDEX "agent_jobs_createdAt_idx" ON "agent_jobs"("createdAt");
CREATE UNIQUE INDEX "agent_job_configs_jobType_key" ON "agent_job_configs"("jobType");
