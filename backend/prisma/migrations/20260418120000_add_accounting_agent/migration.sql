-- Classificació comptable a factures rebudes
ALTER TABLE "received_invoices" ADD COLUMN "accountingType" TEXT;
ALTER TABLE "received_invoices" ADD COLUMN "pgcAccount" TEXT;
ALTER TABLE "received_invoices" ADD COLUMN "pgcAccountName" TEXT;
ALTER TABLE "received_invoices" ADD COLUMN "classifiedBy" TEXT;
ALTER TABLE "received_invoices" ADD COLUMN "classifiedAt" TIMESTAMP(3);
CREATE INDEX "received_invoices_accountingType_idx" ON "received_invoices"("accountingType");

-- Tipus per suggeriments
CREATE TYPE "SuggestionType" AS ENUM ('CLASSIFICATION', 'PGC_ACCOUNT', 'ANOMALY', 'DUPLICATE', 'MISSING_DATA', 'TAX_WARNING');
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- Taula de xat amb l'agent
CREATE TABLE "agent_chats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "messages" JSONB NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_chats_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agent_chats_userId_idx" ON "agent_chats"("userId");
CREATE INDEX "agent_chats_createdAt_idx" ON "agent_chats"("createdAt");
ALTER TABLE "agent_chats" ADD CONSTRAINT "agent_chats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Taula de suggeriments de l'agent
CREATE TABLE "agent_suggestions" (
    "id" TEXT NOT NULL,
    "receivedInvoiceId" TEXT NOT NULL,
    "type" "SuggestionType" NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "suggestedValue" JSONB,
    "confidence" DOUBLE PRECISION,
    "reasoning" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_suggestions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agent_suggestions_receivedInvoiceId_idx" ON "agent_suggestions"("receivedInvoiceId");
CREATE INDEX "agent_suggestions_status_idx" ON "agent_suggestions"("status");
CREATE INDEX "agent_suggestions_type_idx" ON "agent_suggestions"("type");
CREATE INDEX "agent_suggestions_createdAt_idx" ON "agent_suggestions"("createdAt");
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_receivedInvoiceId_fkey" FOREIGN KEY ("receivedInvoiceId") REFERENCES "received_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
