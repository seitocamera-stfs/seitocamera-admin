-- AlterTable
ALTER TABLE "Transport" ADD COLUMN "publicToken" TEXT;

-- Generate unique tokens for existing rows
UPDATE "Transport" SET "publicToken" = gen_random_uuid()::text WHERE "publicToken" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Transport_publicToken_key" ON "Transport"("publicToken");
