FROM node:20-alpine

WORKDIR /app

# Dependències del sistema per compilar mòduls natius (canvas, sharp, etc.)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    pkgconfig \
    pixman-dev \
    cairo-dev \
    pango-dev \
    libjpeg-turbo-dev \
    giflib-dev

# Copiar package files
COPY package*.json ./
COPY prisma ./prisma/

# Instal·lar TOTES les dependències (inclou prisma CLI a devDeps)
RUN npm ci

# Generar Prisma Client
RUN npx prisma generate

# Eliminar devDependencies després de generar Prisma
RUN npm prune --production

# Copiar codi font
COPY src ./src

# Crear directori de logs
RUN mkdir -p logs

# Exposar port
EXPOSE 4000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1

CMD ["node", "src/index.js"]
