-- Afegir SHELLY al enum ServiceProvider
ALTER TYPE "ServiceProvider" ADD VALUE IF NOT EXISTS 'SHELLY';

-- Crear taula de lectures d'energia Shelly
CREATE TABLE IF NOT EXISTS "shelly_energy_readings" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "whPhaseA" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "whPhaseB" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "whPhaseC" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "totalKwh" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "minuteRecords" INTEGER NOT NULL DEFAULT 0,
    "deviceId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shelly_energy_readings_pkey" PRIMARY KEY ("id")
);

-- Índexs
CREATE INDEX IF NOT EXISTS "shelly_energy_readings_date_idx" ON "shelly_energy_readings"("date");
CREATE UNIQUE INDEX IF NOT EXISTS "shelly_energy_readings_date_deviceId_key" ON "shelly_energy_readings"("date", "deviceId");
