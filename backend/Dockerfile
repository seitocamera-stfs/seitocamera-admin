# ========================================================================
# Backend (Node.js) + Marketing module (Python multi-agent)
# ========================================================================
# Build context = repo root (per accedir a `marketing/` també).
# Mantenim el Node.js backend igual que abans, però inclouem un venv
# Python amb només les dependències que el codi usa realment a runtime
# (sense playwright/pgvector/alembic/fastapi → ~150MB en lloc de ~700MB).
# ========================================================================

FROM node:20-alpine

WORKDIR /app

# ---- Dependències del sistema (Node natius + Python runtime) ----
RUN apk add --no-cache \
    openssl \
    python3 \
    py3-pip \
    py3-virtualenv \
    libpq \
    libpq-dev \
    make \
    g++ \
    pkgconfig \
    pixman-dev \
    cairo-dev \
    pango-dev \
    libjpeg-turbo-dev \
    giflib-dev

# ---- Backend Node.js ----
COPY backend/package*.json ./
COPY backend/prisma ./prisma/
RUN npm ci
RUN npx prisma generate
RUN npm prune --production
COPY backend/src ./src
RUN mkdir -p logs

# ---- Marketing Python module ----
# Instal·lem el codi del marketing i un venv minimal a /marketing.
# Només els paquets que el codi importa realment (playwright/pgvector/
# alembic/fastapi/uvicorn declarats a pyproject NO s'usen, fora).
COPY marketing /marketing
RUN python3 -m venv /marketing/.venv && \
    /marketing/.venv/bin/pip install --no-cache-dir --upgrade pip && \
    /marketing/.venv/bin/pip install --no-cache-dir \
        "anthropic>=0.40.0" \
        "pydantic[email]>=2.7.0" \
        "pydantic-settings>=2.2.0" \
        "sqlalchemy>=2.0.30" \
        "psycopg[binary]>=3.1.18" \
        "httpx>=0.27.0" \
        "tenacity>=8.3.0" \
        "structlog>=24.1.0" \
        "rich>=13.7.0" \
        "typer>=0.12.0" \
        "exa-py>=1.0.9" && \
    /marketing/.venv/bin/pip install --no-cache-dir --no-deps -e /marketing && \
    mkdir -p /marketing/out /marketing/logs

# Aprimar imatge: traiem els -dev després de compilar (deixant runtime libs)
RUN apk del make g++ pkgconfig libpq-dev pixman-dev cairo-dev pango-dev libjpeg-turbo-dev giflib-dev || true

# ---- Runtime ----
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1

CMD ["node", "src/index.js"]
