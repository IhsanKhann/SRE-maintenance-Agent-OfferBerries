# SRE Agent Daemon — Production Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache \
  bash \
  curl \
  redis \
  openssh-client \
  python3 \
  docker-cli

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY scripts/ ./scripts/
RUN chmod +x scripts/*.sh

EXPOSE 3500
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3500/ping || exit 1

CMD ["node", "dist/index.js"]
