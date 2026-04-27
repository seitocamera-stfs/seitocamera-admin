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
if [ -d "$REMOTE_DIR" ] && [ "$(pwd)" = "$REMOTE_DIR" -o -f "./docker-compose.yml" ]; then
  cd "$REMOTE_DIR"

  echo "📥 Actualitzant codi..."
  git pull origin main

  echo "📦 Baixant imatges base (postgres, redis, nginx)..."
  docker compose pull postgres redis nginx

  echo "🔨 Construint backend i frontend..."
  docker compose build --no-cache backend frontend

  echo "🔄 Reiniciant serveis..."
  docker compose up -d

  echo "⏳ Esperant que els containers estiguin llests..."
  sleep 10

  # Verificar que tot funciona
  echo "🔍 Verificant serveis..."

  # Backend health
  if docker compose exec -T backend wget -qO- http://localhost:4000/api/health > /dev/null 2>&1; then
    echo "✅ Backend: OK"
  else
    echo "⚠️  Backend: encara arrencant, esperant 10s més..."
    sleep 10
    if docker compose exec -T backend wget -qO- http://localhost:4000/api/health > /dev/null 2>&1; then
      echo "✅ Backend: OK"
    else
      echo "❌ Backend: ERROR — comprova: docker compose logs backend"
    fi
  fi

  # Traefik routing (sense reiniciar coolify-proxy)
  echo "🔍 Verificant routing Traefik..."
  sleep 2
  if docker exec coolify-proxy wget -qO- --timeout=5 http://seitocamera-nginx:80/ > /dev/null 2>&1; then
    echo "✅ Traefik → Nginx: OK"
  else
    echo "⚠️  Traefik → Nginx: esperant que detecti el container..."
    sleep 10
    if docker exec coolify-proxy wget -qO- --timeout=5 http://seitocamera-nginx:80/ > /dev/null 2>&1; then
      echo "✅ Traefik → Nginx: OK"
    else
      echo "❌ Traefik → Nginx: ERROR"
      echo "   Comprova: docker logs coolify-proxy 2>&1 | tail -20"
      echo "   Si cal: docker restart coolify-proxy"
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
