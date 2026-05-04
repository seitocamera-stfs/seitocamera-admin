-- Sprint 1 — Fonaments del nou mòdul de comptabilitat
-- Crea: companies, fiscal_years, chart_of_accounts, audit_logs
-- Modifica: suppliers (afegeix isPublicAdmin)

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

CREATE TYPE "FiscalYearStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED');

-- ============================================
-- TAULA: companies
-- ============================================

CREATE TABLE IF NOT EXISTS "companies" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "commercialName" TEXT,
    "nif" TEXT NOT NULL,
    "address" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "province" TEXT,
    "country" TEXT NOT NULL DEFAULT 'ES',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "defaultVatRate" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "defaultIrpfRate" DECIMAL(5,2) NOT NULL DEFAULT 15,
    "corporateTaxRate" DECIMAL(5,2) NOT NULL DEFAULT 25,
    "aeatRegime" TEXT NOT NULL DEFAULT 'GENERAL',
    "is347Threshold" DECIMAL(12,2) NOT NULL DEFAULT 3005.06,
    "vatPeriod" TEXT NOT NULL DEFAULT 'QUARTERLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "companies_nif_key" ON "companies"("nif");

-- ============================================
-- TAULA: fiscal_years
-- ============================================

CREATE TABLE IF NOT EXISTS "fiscal_years" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "FiscalYearStatus" NOT NULL DEFAULT 'OPEN',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "totalRevenue" DECIMAL(14,2),
    "totalExpenses" DECIMAL(14,2),
    "netResult" DECIMAL(14,2),
    "corporateTax" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_years_companyId_year_key" ON "fiscal_years"("companyId", "year");
CREATE INDEX IF NOT EXISTS "fiscal_years_status_idx" ON "fiscal_years"("status");

ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_lockedById_fkey"
    FOREIGN KEY ("lockedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- TAULA: chart_of_accounts
-- ============================================

CREATE TABLE IF NOT EXISTS "chart_of_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "isLeaf" BOOLEAN NOT NULL DEFAULT true,
    "type" "AccountType" NOT NULL,
    "subtype" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "defaultVatRate" DECIMAL(5,2),
    "taxBookType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "chart_of_accounts_companyId_code_key" ON "chart_of_accounts"("companyId", "code");
CREATE INDEX IF NOT EXISTS "chart_of_accounts_type_idx" ON "chart_of_accounts"("type");
CREATE INDEX IF NOT EXISTS "chart_of_accounts_parentId_idx" ON "chart_of_accounts"("parentId");

ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- TAULA: audit_logs
-- ============================================

CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userId" TEXT NOT NULL,
    "userEmail" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "audit_logs_userId_idx" ON "audit_logs"("userId");
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================
-- ALTER: suppliers — afegir isPublicAdmin
-- ============================================
-- Marca el proveïdor com a Administració Pública (AEAT, Seguretat Social, Generalitat...)
-- Es mostra a la pàgina "Comptes públics" en lloc de "Proveïdors" generals.

ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "isPublicAdmin" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "suppliers_isPublicAdmin_idx" ON "suppliers"("isPublicAdmin");
