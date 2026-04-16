-- Afegir columna customPermissions (JSON) al model User
ALTER TABLE "users" ADD COLUMN "customPermissions" JSONB;
