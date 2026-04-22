-- AlterTable
ALTER TABLE "bank_movements" ADD COLUMN "isDismissed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bank_movements" ADD COLUMN "dismissReason" TEXT;

-- CreateIndex
CREATE INDEX "bank_movements_isDismissed_idx" ON "bank_movements"("isDismissed");
