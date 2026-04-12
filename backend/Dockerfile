FROM node:20-alpine

WORKDIR /app

# Copiar package files
COPY package*.json ./
COPY prisma ./prisma/

# Instal·lar dependències
RUN npm ci --only=production

# Generar Prisma Client
RUN npx prisma generate

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
