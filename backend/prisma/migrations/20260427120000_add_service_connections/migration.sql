-- CreateEnum
CREATE TYPE "ServiceProvider" AS ENUM ('ZOHO_MAIL', 'GOOGLE_DRIVE', 'QONTO', 'GOCARDLESS', 'RENTMAN', 'SMTP');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'ERROR', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "service_connections" (
    "id" TEXT NOT NULL,
    "provider" "ServiceProvider" NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "displayName" TEXT,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "refreshToken" TEXT,
    "accessToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT,
    "apiKey" TEXT,
    "apiSecret" TEXT,
    "config" JSONB,
    "connectedBy" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_connections_provider_key" ON "service_connections"("provider");
