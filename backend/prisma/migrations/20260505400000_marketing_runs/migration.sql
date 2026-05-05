-- Persistència dels runs del subprojecte marketing/ (Python multi-agent).
-- Substitueix l'estat en memòria del backend Node — sobreviuen reinicis i
-- permeten recuperació + endpoint de kill.

CREATE TABLE "marketing_runs" (
  "id"             TEXT PRIMARY KEY,
  "agent"          TEXT NOT NULL,
  "script"         TEXT,
  "status"         TEXT NOT NULL DEFAULT 'running',  -- running/completed/failed/killed/abandoned
  "pid"            INTEGER,
  "hostname"       TEXT,
  "startedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "endedAt"        TIMESTAMPTZ,
  "logFile"        TEXT NOT NULL,
  "outputFile"     TEXT,
  "error"          TEXT,
  "spentUsd"       DECIMAL(10, 4),
  "summary"        JSONB,
  "triggeredById"  TEXT,

  CONSTRAINT "marketing_runs_status_check" CHECK ("status" IN ('running','completed','failed','killed','abandoned'))
);

CREATE INDEX "marketing_runs_status_idx" ON "marketing_runs" ("status");
CREATE INDEX "marketing_runs_started_idx" ON "marketing_runs" ("startedAt" DESC);
