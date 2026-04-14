-- DropForeignKey
ALTER TABLE "received_invoices" DROP CONSTRAINT "received_invoices_supplierId_fkey";

-- AlterTable
ALTER TABLE "received_invoices" ALTER COLUMN "supplierId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "received_invoices" ADD CONSTRAINT "received_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
