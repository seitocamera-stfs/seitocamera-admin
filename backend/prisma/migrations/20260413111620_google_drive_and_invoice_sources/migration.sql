/*
  Warnings:

  - You are about to drop the column `pcloudPath` on the `received_invoices` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "received_invoices" DROP COLUMN "pcloudPath",
ADD COLUMN     "gdriveFileId" TEXT;
