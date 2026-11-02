# ── Etapa 1: dependencias + compilación ──────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma7.config.ts tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build

# ── Etapa 2: runtime mínimo ──────────────────────────────
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY prisma7.config.ts ./
COPY prisma ./prisma
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/uploads && chown -R node:node /app
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1

# migrate deploy al arrancar (idempotente) y luego la API
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
