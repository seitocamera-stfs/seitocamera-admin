# SeitoCamera Admin

Plataforma de gestió integral per a SeitoCamera, empresa de lloguer d'equip audiovisual a Barcelona. Gestió de factures, conciliació bancària, operacions de projectes, logística, equips i equip humà.

## Stack

- **Backend:** Node.js 20, Express 4, Prisma 5 (PostgreSQL), Redis (ioredis)
- **Frontend:** React 18, Vite, Tailwind CSS, Radix UI, Recharts, Lucide icons
- **Infra:** Docker Compose (postgres 16, redis 7, backend, frontend, nginx), Traefik al servidor
- **Integracions:** Qonto (banca), Rentman (ERP lloguer), Zoho Mail, Google Drive, Claude API (OCR/IA), Shelly (IoT)

## Arquitectura

```
frontend (React SPA, port 3000)
  └─ nginx (reverse proxy, ports 80/443)
       └─ backend (Express API, port 4000)
            ├─ PostgreSQL (port 5432)
            └─ Redis (port 6379)
```

El frontend crida `/api/*` que nginx redirigeix al backend. Autenticació via JWT (access + refresh tokens).

## Directoris clau

```
backend/
  src/
    routes/        — Express routers (invoices.js i operations.js són els més grans, ~95KB cadascun)
    services/      — Lògica de negoci, integracions API externes
    jobs/          — Cron jobs (zohoEmailSync, qontoBankSync, gdrivSync, rentmanSync, qontoDropzone, shelly)
    config/        — database.js (prisma), redis.js, logger.js (winston), company.js
    middleware/    — auth (JWT verify), authorize (role check), rateLimiter, upload (multer)
  prisma/
    schema.prisma  — Tot el schema (models, enums, relacions)
    migrations/    — Migracions SQL manuals (no auto-generated)

frontend/
  src/
    pages/         — Components de pàgina (operations/, logistics/, etc.)
    components/    — Shared UI (Modal, layout, Sidebar, NotificationBell)
    hooks/         — useApi (GET amb SWR), usePushNotifications
    stores/        — Zustand (authStore)
    lib/           — api.js (axios instance amb interceptors JWT)
```

## Comandes habituals

### Desenvolupament local (Mac)

```bash
# Backend
cd backend
npm install
cp ../.env.production.example .env  # editar amb credencials locals
npx prisma generate
npx prisma migrate deploy
npm run dev                          # nodemon, port 4000

# Frontend
cd frontend
npm install
npm run dev                          # vite, port 5173
```

### Docker (local)

```bash
docker compose up -d                 # tots els serveis
docker compose logs -f backend       # veure logs backend
docker compose exec backend npx prisma studio  # GUI base de dades
```

### Deploy a producció

El servidor és un VPS a `213.210.20.138` (SSH com root). **No té repo git** — deploy via Docker.

```bash
# Opció 1: des del Mac
git push origin main
ssh root@213.210.20.138 "cd /opt/seitocamera && bash deploy.sh"

# Opció 2: manual pas a pas
ssh root@213.210.20.138
cd /opt/seitocamera
git pull origin main
docker compose build --no-cache backend frontend
docker compose up -d
docker compose exec -T backend npx prisma migrate deploy
```

**IMPORTANT:** Mai fer `git pull` dins del container — el deploy sempre és `docker compose build` + `up -d`.

### Migracions Prisma

```bash
# Crear migració (des de backend/)
npx prisma migrate dev --name nom_de_la_migracio

# Les migracions es creen manualment: mkdir prisma/migrations/YYYYMMDDHHMMSS_nom/
# i s'escriu el SQL a migration.sql

# Aplicar a producció
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npx prisma generate
docker compose restart backend
```

## Patrons del codebase

### Backend routes

- Validació amb Zod (`validate(schema)` middleware)
- Autorització per rol: `authorize('ADMIN', 'EDITOR')`
- Sempre `try/catch` amb `next(err)` per errors
- Transaccions amb `prisma.$transaction()` per operacions atòmiques
- Logging amb `logger.info/warn/error` (winston)

### Frontend

- `useApiGet(url, params)` — hook SWR per GET amb refetch automàtic
- `api.post/put/patch/delete` — axios instance amb JWT interceptor
- Components modals via `<Modal>` shared
- Estils: Tailwind utilities, sense CSS custom
- Icones: Lucide React exclusivament
- No usar `useNavigate` a components fills — passar callbacks
- Estat local amb `useState`, global amb Zustand (`authStore`)

### Enums importants (Prisma)

- `ProjectStatus`: PENDING_PREP, IN_PREPARATION, READY, OUT, RETURNED, CLOSED
- `TaskCategory`: GENERAL, TECH, WAREHOUSE, LOGISTIC, ADMIN
- `TaskPriority`: LOW, NORMAL, HIGH, URGENT
- `InvoiceStatus`: PENDING, REVIEWED, APPROVED, REJECTED, PAID, PARTIALLY_PAID, NOT_INVOICE
- `Role`: ADMIN, EDITOR, VIEWER, DRIVER, WAREHOUSE, CUSTOM

### Jobs (cron)

Tots segueixen el mateix patró:
1. Redis lock per evitar execucions concurrents
2. Funció `run*()` exportada per execució manual des de routes
3. Funció `start*Job()` que programa el cron i fa execució inicial amb delay
4. Resultat guardat a Redis per consulta des del frontend

### Conciliació bancària

`BankMovement` ↔ `Conciliation` ↔ `ReceivedInvoice/IssuedInvoice`

El camp `qontoSlug` identifica moviments de Qonto. `rawData` conté la resposta original de l'API amb `attachment_ids`. El job `qontoDropzoneJob` copia factures conciliades a la carpeta Dropzone de Google Drive perquè Qonto Connect les associï als moviments.

## Variables d'entorn crítiques

```
DATABASE_URL=postgresql://user:pass@localhost:5432/seitocamera_admin
REDIS_URL=redis://:password@localhost:6379
JWT_SECRET=...
JWT_REFRESH_SECRET=...
FRONTEND_URL=https://admin.seito.camera

# Integracions (opcionals, el sistema funciona sense)
ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
QONTO_ORG_SLUG, QONTO_SECRET_KEY
QONTO_DROPZONE_FOLDER_ID
RENTMAN_API_TOKEN
ANTHROPIC_API_KEY
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
```

## Idioma

El codi barreja anglès (noms de funcions, variables, comments tècnics) i català (UI, missatges d'error per l'usuari, noms de camps de negoci). Sempre mantenir aquest patró: codi en anglès, contingut visible per l'usuari en català.

## Coses a evitar

- No tocar `pdfExtractService.js` (71KB) sense entendre el flux complet — és el motor OCR central
- No canviar els enums de Prisma sense migració SQL amb DROP DEFAULT / recrear enum / SET DEFAULT
- No fer `docker compose down -v` al servidor — esborra els volums de dades!
- No afegir deps pesants al frontend (ja és ~2MB bundled)
- No fer `git push --force` a main — és la branca de producció
- Mai guardar secrets o tokens als fitxers commitejats
