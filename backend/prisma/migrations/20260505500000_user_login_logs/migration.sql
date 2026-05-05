-- Historial d'accessos d'usuari + lastSeenAt al User.
--
-- UserLoginLog: cada login (success o fail) deixa una entrada. Permet a
-- l'admin veure qui entra a l'app, des d'on (IP), amb quin browser, i si
-- algú està intentant entrar amb credencials erronies.
--
-- User.lastSeenAt: marca a cada request autenticat (throttled cada 5 min al
-- middleware) per detectar usuaris que estan loguejats però no fan res.

ALTER TABLE "users"
  ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE TABLE "user_login_logs" (
  "id"           TEXT PRIMARY KEY,
  "userId"       TEXT,
  "email"        TEXT NOT NULL,
  "loggedInAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ipAddress"    TEXT,
  "userAgent"    TEXT,
  "success"      BOOLEAN NOT NULL DEFAULT true,
  "failReason"   TEXT,

  CONSTRAINT "user_login_logs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "user_login_logs_userId_loggedInAt_idx"
  ON "user_login_logs" ("userId", "loggedInAt" DESC);

CREATE INDEX "user_login_logs_loggedInAt_idx"
  ON "user_login_logs" ("loggedInAt" DESC);

CREATE INDEX "user_login_logs_email_idx"
  ON "user_login_logs" ("email");
