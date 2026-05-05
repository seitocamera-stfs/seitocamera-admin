-- Llocs predeterminats per origen/destí de transports + nou camp horaCarrega.
--
-- LogisticsLocation: catàleg d'ubicacions reutilitzables (HQ propi, platos
-- de clients habituals, magatzems...). Els camps `origen` i `desti` del
-- Transport segueixen sent text lliure — aquesta taula només alimenta
-- l'autocomplete del frontend.
--
-- Transport.horaCarrega: hora a la qual el conductor carrega el material
-- al magatzem o origen abans d'anar al destí (separada de la "hora de
-- recollida" que és quan arriba a casa del client en transports tipus
-- Recollida).

ALTER TABLE "transports"
  ADD COLUMN "horaCarrega" TEXT;

CREATE TABLE "logistics_locations" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL UNIQUE,
  "address"     TEXT,
  "kind"        TEXT DEFAULT 'OTHER',  -- HQ / STUDIO / CLIENT / OTHER
  "isFavorite"  BOOLEAN NOT NULL DEFAULT false,
  "notes"       TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "logistics_locations_isFavorite_idx"
  ON "logistics_locations" ("isFavorite");

-- Seed amb la pròpia HQ (SeitoCamera) marcada com a favorita
INSERT INTO "logistics_locations" ("id", "name", "address", "kind", "isFavorite")
VALUES (
  'loc_seitocamera_hq',
  'SeitoCamera',
  COALESCE(
    (SELECT CONCAT_WS(', ', NULLIF(address,''), NULLIF("postalCode",''), NULLIF(city,''))
     FROM companies
     WHERE address IS NOT NULL OR "postalCode" IS NOT NULL OR city IS NOT NULL
     LIMIT 1),
    'Sant Just Desvern, Barcelona'
  ),
  'HQ',
  true
)
ON CONFLICT ("name") DO NOTHING;
