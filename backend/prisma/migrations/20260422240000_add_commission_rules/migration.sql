-- CreateTable
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percentage" DECIMAL(5,3) NOT NULL DEFAULT 0,
    "fixedFee" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commission_rules_name_key" ON "commission_rules"("name");

-- Seed: regles de comissions habituals
INSERT INTO "commission_rules" ("id", "name", "percentage", "fixedFee", "keywords", "updatedAt") VALUES
  ('comm_stripe', 'Stripe', 1.500, 0.25, ARRAY['stripe'], NOW()),
  ('comm_paypal', 'PayPal', 2.900, 0.35, ARRAY['paypal'], NOW()),
  ('comm_tpv', 'TPV Bancari', 0.700, 0.00, ARRAY['tpv', 'redsys', 'servired'], NOW()),
  ('comm_bizum', 'Bizum', 0.000, 0.00, ARRAY['bizum'], NOW()),
  ('comm_sumup', 'SumUp', 1.690, 0.00, ARRAY['sumup', 'sum up'], NOW()),
  ('comm_square', 'Square', 1.650, 0.10, ARRAY['square', 'sq *'], NOW());
