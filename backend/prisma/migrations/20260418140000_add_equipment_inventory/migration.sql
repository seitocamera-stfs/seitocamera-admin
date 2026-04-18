-- Camp per marcar si ja s'ha intentat extreure equips
ALTER TABLE "received_invoices" ADD COLUMN "equipmentExtracted" BOOLEAN NOT NULL DEFAULT false;

-- Taula d'inventari d'equips
CREATE TABLE "equipment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serialNumber" TEXT,
    "category" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "purchasePrice" DECIMAL(12,2),
    "purchaseDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "extractedBy" TEXT NOT NULL DEFAULT 'MANUAL',
    "rawExtractedData" JSONB,
    "receivedInvoiceId" TEXT,
    "supplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "equipment_receivedInvoiceId_idx" ON "equipment"("receivedInvoiceId");
CREATE INDEX "equipment_supplierId_idx" ON "equipment"("supplierId");
CREATE INDEX "equipment_serialNumber_idx" ON "equipment"("serialNumber");
CREATE INDEX "equipment_category_idx" ON "equipment"("category");
CREATE INDEX "equipment_status_idx" ON "equipment"("status");

ALTER TABLE "equipment" ADD CONSTRAINT "equipment_receivedInvoiceId_fkey" FOREIGN KEY ("receivedInvoiceId") REFERENCES "received_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
