-- Empreses logístiques
CREATE TABLE "empreses_logistica" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "emailContacte" TEXT,
    "telefonContacte" TEXT,
    "nomContacte" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "empreses_logistica_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "empreses_logistica_nom_key" ON "empreses_logistica"("nom");

-- Conductors
CREATE TABLE "conductors" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telefon" TEXT,
    "empresaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conductors_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "conductors" ADD CONSTRAINT "conductors_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empreses_logistica"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Transports
CREATE TABLE "transports" (
    "id" TEXT NOT NULL,
    "projecte" TEXT,
    "tipusServei" TEXT NOT NULL DEFAULT 'Entrega',
    "origen" TEXT,
    "notesOrigen" TEXT,
    "desti" TEXT,
    "notesDesti" TEXT,
    "dataCarrega" DATE,
    "dataEntrega" DATE,
    "horaRecollida" TEXT,
    "horaEntregaEstimada" TEXT,
    "horaFiPrevista" TEXT,
    "horaIniciReal" TEXT,
    "horaFiReal" TEXT,
    "minutsExtres" INTEGER,
    "responsableProduccio" TEXT,
    "telefonResponsable" TEXT,
    "conductorId" TEXT,
    "empresaId" TEXT,
    "estat" TEXT NOT NULL DEFAULT 'Pendent',
    "motiuCancellacio" TEXT,
    "cancellatAt" TIMESTAMP(3),
    "notes" TEXT,
    "historial" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transports_estat_idx" ON "transports"("estat");
CREATE INDEX "transports_dataCarrega_idx" ON "transports"("dataCarrega");
CREATE INDEX "transports_conductorId_idx" ON "transports"("conductorId");
CREATE INDEX "transports_empresaId_idx" ON "transports"("empresaId");

ALTER TABLE "transports" ADD CONSTRAINT "transports_conductorId_fkey" FOREIGN KEY ("conductorId") REFERENCES "conductors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transports" ADD CONSTRAINT "transports_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empreses_logistica"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transports" ADD CONSTRAINT "transports_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
