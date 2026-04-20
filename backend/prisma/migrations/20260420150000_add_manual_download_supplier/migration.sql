-- AlterTable: afegir camps de recollida manual de factures al proveïdor
ALTER TABLE "suppliers" ADD COLUMN "requiresManualDownload" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "suppliers" ADD COLUMN "manualDownloadUrl" TEXT;
