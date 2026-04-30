-- AlterTable
ALTER TABLE "transports" ADD COLUMN "publicToken" TEXT;

-- Generate unique tokens for existing rows
UPDATE "transports" SET "publicToken" = gen_random_uuid()::text WHERE "publicToken" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Transport_publicToken_key" ON "transports"("publicToken");
