-- Marketing prospect support on Client.
-- A "prospect" is a Client record without facturation yet; produced by the
-- Marketing AI Lead Hunter. Once the first invoice is issued, it becomes a
-- regular client (UI just toggles isProspect=false; no model change).

ALTER TABLE "clients"
  ADD COLUMN "isProspect"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "source"            TEXT,
  ADD COLUMN "prospectMetadata"  JSONB,
  ADD COLUMN "prospectImportedAt" TIMESTAMPTZ;

-- Index per filtrar prospects ràpidament a la UI
CREATE INDEX "clients_isProspect_idx" ON "clients" ("isProspect");
