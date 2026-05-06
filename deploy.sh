#!/bin/bash
# ===========================================
# Deploy SeitoCamera Admin a producció
# ===========================================
#
# Flux real (descobert maig 2026):
#   1. Tu fas `git push origin main` des del Mac
#   2. GitHub Actions construeix les imatges Docker (~3-5 min) i les puja
#      a ghcr.io/seitocamera-stfs/seitocamera-admin/{backend,frontend,nginx}
#   3. Aquest script (al servidor) fa `docker compose pull` per baixar les
#      imatges noves del registry, recrea els containers, aplica migracions
#      Prisma i fa healthcheck.
#
# IMPORTANT: el `docker-compose.yml` usa `image: ghcr.io/...` (NO `build:`).
# Per tant el codi al servidor (`/opt/seitocamera/backend/src/...`) NO s'usa
# en runtime — només el de la imatge. NO té sentit `docker compose build`
# ni `git pull` (el directori no és repo git).
#
# Ús:
#   bash deploy.sh                  # mode normal (espera 0s)
#   bash deploy.sh --wait            # espera 4 min abans de pull (per donar
#                                    # temps al GitHub Actions a construir)
#   bash deploy.sh --no-migrate      # salta `prisma migrate deploy`
#
# Si el GitHub Actions encara està construint, el `pull` baixarà la imatge
# anterior. Solució: esperar i tornar a fer `bash deploy.sh`.
# ===========================================

set -e

WAIT=0
SKIP_MIGRATE=0
for arg in "$@"; do
  case "$arg" in
    --wait)        WAIT=240 ;;
    --no-migrate)  SKIP_MIGRATE=1 ;;
    --help|-h)
      sed -n '2,30p' "$0" | sed 's/^# *//'
      exit 0 ;;
  esac
done

cd /opt/seitocamera

echo "🚀 Desplegant SeitoCamera Admin..."

if [ "$WAIT" -gt 0 ]; then
  echo "⏳ Esperant $WAIT s perquè el GitHub Actions acabi de construir..."
  sleep "$WAIT"
fi

echo ""
echo "📥 Baixant imatges noves de ghcr.io..."
docker compose pull backend frontend nginx 2>&1 | grep -E "Pull|Error|already" | tail -10 || true

echo ""
echo "🔄 Recreant containers (force-recreate per re-llegir env_file)..."
docker compose up -d --force-recreate --no-deps backend frontend nginx

echo ""
echo "⏳ Esperant que el backend estigui llest..."
for i in $(seq 1 30); do
  if docker compose exec -T backend wget -qO- http://localhost:4000/api/health >/dev/null 2>&1; then
    echo "✅ Backend healthy (esperat ${i}×2 s)"
    break
  fi
  sleep 2
  if [ "$i" = "30" ]; then
    echo "❌ Backend NO respon després de 60s. Comprova:"
    echo "   docker compose logs --tail=50 backend"
    exit 1
  fi
done

# Migracions Prisma
if [ "$SKIP_MIGRATE" = "0" ]; then
  echo ""
  echo "🗄️  Aplicant migracions Prisma..."
  MIGRATE_OUT=$(docker compose exec -T backend npx prisma migrate deploy 2>&1)
  echo "$MIGRATE_OUT" | grep -E "migration|Applied|already in sync|No pending|error" | tail -5

  # Si hi ha hagut migracions noves, regenerar Prisma Client + restart
  if echo "$MIGRATE_OUT" | grep -qE "Applying migration|migrations have been"; then
    echo ""
    echo "🔧 Migracions noves aplicades — regenerant Prisma Client..."
    docker compose exec -T backend npx prisma generate >/dev/null 2>&1
    docker compose restart backend >/dev/null 2>&1
    sleep 5
  fi
fi

# Verificació Traefik (Coolify proxy) — opcional, no crítica
if docker ps --format '{{.Names}}' | grep -q '^coolify-proxy$'; then
  if docker exec coolify-proxy wget -qO- --timeout=5 http://seitocamera-nginx:80/ >/dev/null 2>&1; then
    echo "✅ Traefik → Nginx: OK"
  else
    echo "⚠️  Traefik no troba nginx encara. Pot tardar 10-30s. Si persisteix:"
    echo "   docker restart coolify-proxy"
  fi
fi

echo ""
echo "✅ Deploy completat!"
docker compose ps --format "table {{.Name}}\t{{.Status}}"

echo ""
echo "💡 Logs en directe del backend:  docker compose logs -f backend"
