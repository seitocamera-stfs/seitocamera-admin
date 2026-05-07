-- ============================================================
-- XAT INTERN — canals d'equip + missatges + mencions + adjunts
-- ============================================================

-- Tipus de canal
DO $$ BEGIN
  CREATE TYPE "ChatChannelType" AS ENUM ('TEAM', 'PROJECT', 'DM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Canals
CREATE TABLE IF NOT EXISTS "chat_channels" (
  "id"           TEXT PRIMARY KEY,
  "name"         TEXT NOT NULL,
  "description"  TEXT,
  "type"         "ChatChannelType" NOT NULL DEFAULT 'TEAM',
  "color"        TEXT,
  "icon"         TEXT,
  "isArchived"   BOOLEAN NOT NULL DEFAULT FALSE,
  "createdById"  TEXT,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "chat_channels_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "chat_channels_type_idx"       ON "chat_channels" ("type");
CREATE INDEX IF NOT EXISTS "chat_channels_isArchived_idx" ON "chat_channels" ("isArchived");

-- Membres del canal
CREATE TABLE IF NOT EXISTS "chat_members" (
  "channelId"          TEXT NOT NULL,
  "userId"             TEXT NOT NULL,
  "role"               TEXT NOT NULL DEFAULT 'MEMBER',
  "joinedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "lastReadAt"         TIMESTAMPTZ,
  "notifyMentionsOnly" BOOLEAN NOT NULL DEFAULT FALSE,

  PRIMARY KEY ("channelId", "userId"),

  CONSTRAINT "chat_members_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "chat_channels"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_members_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "chat_members_userId_idx" ON "chat_members" ("userId");

-- Adjunts (els creem abans que messages perquè la FK ho necessita)
CREATE TABLE IF NOT EXISTS "chat_attachments" (
  "id"            TEXT PRIMARY KEY,
  "channelId"     TEXT NOT NULL,
  "filename"      TEXT NOT NULL,
  "originalName"  TEXT NOT NULL,
  "mimeType"      TEXT NOT NULL,
  "sizeBytes"     INTEGER NOT NULL,
  "uploadedById"  TEXT,
  "uploadedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "chat_attachments_channelId_idx" ON "chat_attachments" ("channelId");

-- Missatges
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id"           TEXT PRIMARY KEY,
  "channelId"    TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "content"      TEXT NOT NULL,
  "attachmentId" TEXT,
  "editedAt"     TIMESTAMPTZ,
  "deletedAt"    TIMESTAMPTZ,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "chat_messages_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "chat_channels"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_messages_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_messages_attachmentId_fkey"
    FOREIGN KEY ("attachmentId") REFERENCES "chat_attachments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "chat_messages_channelId_createdAt_idx"
  ON "chat_messages" ("channelId", "createdAt");
CREATE INDEX IF NOT EXISTS "chat_messages_userId_idx" ON "chat_messages" ("userId");

-- Mencions
CREATE TABLE IF NOT EXISTS "chat_message_mentions" (
  "messageId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  PRIMARY KEY ("messageId", "userId"),

  CONSTRAINT "chat_message_mentions_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_message_mentions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "chat_message_mentions_userId_idx" ON "chat_message_mentions" ("userId");
