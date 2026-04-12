#!/bin/bash
# ===========================================
# SeitoCamera Admin — Script de setup inicial
# ===========================================

set -e

echo "🎬 SeitoCamera Admin — Setup"
echo "================================"

# 1. Copiar .env si no existeix
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✅ .env creat (recorda personalitzar els valors!)"
else
  echo "ℹ️  .env ja existeix"
fi

# 2. Copiar .env del backend
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "✅ backend/.env creat"
else
  echo "ℹ️  backend/.env ja existeix"
fi

# 3. Instal·lar dependències
echo ""
echo "📦 Instal·lant dependències del backend..."
cd backend && npm install && cd ..

echo ""
echo "📦 Instal·lant dependències del frontend..."
cd frontend && npm install && cd ..

# 4. Aixecar serveis de desenvolupament
echo ""
echo "🐳 Aixecant PostgreSQL i Redis..."
docker compose -f docker-compose.dev.yml up -d

# 5. Esperar que PostgreSQL estigui llest
echo "⏳ Esperant PostgreSQL..."
sleep 3

# 6. Executar migracions Prisma
echo ""
echo "🔄 Executant migracions..."
cd backend && npx prisma migrate dev --name init && cd ..

# 7. Seed de la base de dades
echo ""
echo "🌱 Executant seed..."
cd backend && npx prisma db seed && cd ..

echo ""
echo "================================"
echo "✅ Setup completat!"
echo ""
echo "Per arrencar en mode desenvolupament:"
echo "  Terminal 1: cd backend && npm run dev"
echo "  Terminal 2: cd frontend && npm run dev"
echo ""
echo "O amb Docker Compose complet:"
echo "  docker compose up --build"
echo "================================"
