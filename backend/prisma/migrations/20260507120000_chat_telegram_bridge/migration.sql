-- Bridge bidireccional Xat intern ↔ Telegram (grups)

-- 1) User: necessitem el Telegram USER ID (no només chatId privat) per
--    identificar autors en grups
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegramUserId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_telegramUserId_key"
  ON "users" ("telegramUserId") WHERE "telegramUserId" IS NOT NULL;

-- 2) ChatChannel: enllaç opcional amb un grup de Telegram
ALTER TABLE "chat_channels"
  ADD COLUMN IF NOT EXISTS "telegramGroupChatId"  TEXT,
  ADD COLUMN IF NOT EXISTS "telegramGroupTitle"   TEXT,
  ADD COLUMN IF NOT EXISTS "telegramLinkCode"     TEXT,
  ADD COLUMN IF NOT EXISTS "telegramLinkExpires"  TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS "chat_channels_telegramGroupChatId_key"
  ON "chat_channels" ("telegramGroupChatId") WHERE "telegramGroupChatId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "chat_channels_telegramLinkCode_key"
  ON "chat_channels" ("telegramLinkCode") WHERE "telegramLinkCode" IS NOT NULL;

-- 3) ChatMessage: tracking del missatge Telegram (per evitar reimports)
ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "telegramMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "source"            TEXT NOT NULL DEFAULT 'APP';
