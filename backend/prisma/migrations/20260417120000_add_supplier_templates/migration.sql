-- CreateTable
CREATE TABLE "supplier_templates" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoicePatterns" JSONB,
    "invoicePrefix" TEXT,
    "filePatterns" JSONB,
    "knownNifs" JSONB,
    "avgAmount" DECIMAL(12,2),
    "minAmount" DECIMAL(12,2),
    "maxAmount" DECIMAL(12,2),
    "commonTaxRate" DECIMAL(5,2),
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_templates_supplierId_key" ON "supplier_templates"("supplierId");

-- AddForeignKey
ALTER TABLE "supplier_templates" ADD CONSTRAINT "supplier_templates_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
