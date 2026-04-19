-- AlterTable: afegir camps IRPF a factures rebudes
ALTER TABLE "received_invoices" ADD COLUMN "irpfRate" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "received_invoices" ADD COLUMN "irpfAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
