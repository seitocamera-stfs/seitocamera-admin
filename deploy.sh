#!/bin/bash
# ===========================================
# Deploy SeitoCamera Admin a producció
# Ús: ssh root@213.210.20.138 "cd /opt/seitocamera && bash deploy.sh"
# O des del Mac: bash deploy.sh (amb SSH)
# ===========================================

set -e

SERVER="root@213.210.20.138"
REMOTE_DIR="/opt/seitocamera"

echo "🚀 Desplegant SeitoCamera Admin..."

# Si estem al servidor directament
if [ "$(hostname)" != "$(echo $HOSTNAME)" ] || [ -d "$REMOTE_DIR" ]; then
  cd "$REMOTE_DIR"

  echo "📦 Baixant imatges noves..."
  docker compose pull

  echo "🔄 Reiniciant serveis..."
  docker compose up -d

  echo "⏳ Esperant que els containers estiguin llests..."
  sleep 5

  echo "🔄 Reiniciant Traefik (coolify-proxy) per refrescar rutes..."
  docker restart coolify-proxy

  echo "⏳ Esperant Traefik..."
  sleep 3

  # Verificar que tot funciona
  echo "🔍 Verificant serveis..."
  if docker compose exec -T backend wget -qO- http://localhost:4000/api/health > /dev/null 2>&1; then
    echo "✅ Backend: OK"
  else
    echo "❌ Backend: ERROR"
  fi

  if docker exec coolify-proxy wget -qO- --timeout=5 http://seitocamera-nginx:80/ > /dev/null 2>&1; then
    echo "✅ Traefik → Nginx: OK"
  else
    echo "⚠️  Traefik → Nginx: no respon, esperant..."
    sleep 5
    docker restart coolify-proxy
    sleep 3
    if docker exec coolify-proxy wget -qO- --timeout=5 http://seitocamera-nginx:80/ > /dev/null 2>&1; then
      echo "✅ Traefik → Nginx: OK (després de 2n intent)"
    else
      echo "❌ Traefik → Nginx: ERROR — comprova docker logs coolify-proxy"
    fi
  fi

  # Aplicar migracions pendents
  echo "🗄️  Aplicant migracions Prisma..."
  docker compose exec -T backend npx prisma migrate deploy 2>&1 | tail -3

  echo ""
  echo "✅ Deploy completat!"
  docker compose ps --format "table {{.Name}}\t{{.Status}}"

else
  # Estem al Mac, executar via SSH
  echo "📡 Connectant al servidor..."
  ssh "$SERVER" "cd $REMOTE_DIR && bash deploy.sh"
fi
