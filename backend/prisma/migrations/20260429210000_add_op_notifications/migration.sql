-- Crear taula op_notifications (faltava migració)
CREATE TABLE IF NOT EXISTS "op_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "op_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "op_notifications_userId_isRead_idx" ON "op_notifications"("userId", "isRead");
CREATE INDEX IF NOT EXISTS "op_notifications_createdAt_idx" ON "op_notifications"("createdAt");
