-- Telegram: vinculació opcional d'usuari amb el seu chat de Telegram
-- per rebre recordatoris de tasques.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "telegramChatId"      TEXT,
  ADD COLUMN IF NOT EXISTS "telegramUsername"    TEXT,
  ADD COLUMN IF NOT EXISTS "telegramLinkCode"    TEXT,
  ADD COLUMN IF NOT EXISTS "telegramLinkExpires" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "telegramLinkedAt"    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "notifyTelegram"      BOOLEAN NOT NULL DEFAULT TRUE;

-- Codi de vinculació únic (per validar /start <code>)
CREATE UNIQUE INDEX IF NOT EXISTS "users_telegramLinkCode_key"
  ON "users" ("telegramLinkCode")
  WHERE "telegramLinkCode" IS NOT NULL;

-- Registre d'enviaments per evitar duplicats per (taskId, userId, channel, kind)
CREATE TABLE IF NOT EXISTS "task_reminder_sent" (
  "id"       TEXT PRIMARY KEY,
  "taskId"   TEXT NOT NULL,
  "userId"   TEXT NOT NULL,
  "channel"  TEXT NOT NULL,    -- 'telegram' | 'push' | 'email'
  "kind"     TEXT NOT NULL,    -- AT_TIME | HOUR_BEFORE | DAY_BEFORE | CUSTOM
  "sentAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "task_reminder_sent_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "task_reminder_sent_unique"
  ON "task_reminder_sent" ("taskId", "userId", "channel", "kind");

CREATE INDEX IF NOT EXISTS "task_reminder_sent_taskId_idx"
  ON "task_reminder_sent" ("taskId");
