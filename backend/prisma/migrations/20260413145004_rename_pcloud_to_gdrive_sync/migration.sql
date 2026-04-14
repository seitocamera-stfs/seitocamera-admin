/*
  Warnings:

  - The values [PCLOUD_SYNC] on the enum `InvoiceSource` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "InvoiceSource_new" AS ENUM ('MANUAL', 'EMAIL_WITH_PDF', 'EMAIL_NO_PDF', 'GDRIVE_SYNC', 'BANK_DETECTED');
ALTER TABLE "received_invoices" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "received_invoices" ALTER COLUMN "source" TYPE "InvoiceSource_new" USING ("source"::text::"InvoiceSource_new");
ALTER TYPE "InvoiceSource" RENAME TO "InvoiceSource_old";
ALTER TYPE "InvoiceSource_new" RENAME TO "InvoiceSource";
DROP TYPE "InvoiceSource_old";
ALTER TABLE "received_invoices" ALTER COLUMN "source" SET DEFAULT 'MANUAL';
COMMIT;
