-- Càlcul automàtic de cost per cada Transport.
-- Fórmula: cost = tarifaPerCategoria + (foraBarcelona ? km × costPerKm : 0) + minutsExtres × tarifaHora/60
--
-- Categoria de servei: ENTREGA_RECOLLIDA, RODATGE_DIA, INTERN, ALTRE
-- ALTRE → cost manual (no es calcula auto)

ALTER TABLE "transports"
  ADD COLUMN "tipusServeiCategoria" TEXT,                          -- ENTREGA_RECOLLIDA / RODATGE_DIA / INTERN / ALTRE
  ADD COLUMN "foraBarcelona"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "kmAnadaTornada"       DECIMAL(8, 2),                 -- km totals (anada + tornada)
  ADD COLUMN "costCalculat"         DECIMAL(10, 2),                -- cache del càlcul automàtic
  ADD COLUMN "costManual"           DECIMAL(10, 2),                -- override manual (si !=null, té prioritat)
  ADD COLUMN "costBreakdown"        JSONB,                         -- desglós: { servei, km, hores, total }
  ADD COLUMN "costCalculatAt"       TIMESTAMPTZ;

-- Taula singleton de configuració de tarifes
CREATE TABLE "transport_cost_configs" (
  "id"                       TEXT PRIMARY KEY DEFAULT 'default',
  "costEntregaRecollida"     DECIMAL(8, 2) NOT NULL DEFAULT 30.00,
  "costRodatgeDia"           DECIMAL(8, 2) NOT NULL DEFAULT 80.00,
  "costIntern"               DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  "costPerKm"                DECIMAL(6, 3) NOT NULL DEFAULT 0.200,
  "tarifaHoraExtra"          DECIMAL(6, 2) NOT NULL DEFAULT 25.00,
  "updatedAt"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedById"              TEXT
);

-- Singleton inicial amb defaults
INSERT INTO "transport_cost_configs" ("id") VALUES ('default')
ON CONFLICT ("id") DO NOTHING;
