-- CreateTable
CREATE TABLE "counterparty_map" (
    "id" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "supplierId" TEXT,
    "clientId" TEXT,
    "matchCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counterparty_map_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "counterparty_map_counterparty_idx" ON "counterparty_map"("counterparty");

-- CreateIndex (unique constraints)
CREATE UNIQUE INDEX "counterparty_map_counterparty_supplierId_key" ON "counterparty_map"("counterparty", "supplierId");
CREATE UNIQUE INDEX "counterparty_map_counterparty_clientId_key" ON "counterparty_map"("counterparty", "clientId");

-- AddForeignKey
ALTER TABLE "counterparty_map" ADD CONSTRAINT "counterparty_map_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "counterparty_map" ADD CONSTRAINT "counterparty_map_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
