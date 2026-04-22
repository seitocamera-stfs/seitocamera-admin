-- AlterTable
ALTER TABLE "equipment" ADD COLUMN "parentId" TEXT;

-- CreateIndex
CREATE INDEX "equipment_parentId_idx" ON "equipment"("parentId");

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
