# ─────────────────────────────────────────────
# Stage 1: Install dependencies
# ─────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests first to leverage Docker layer cache
COPY package*.json ./
# Use npm ci if lockfile exists (CI/CD), otherwise fall back to npm install
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ─────────────────────────────────────────────
# Stage 2: Production image
# ─────────────────────────────────────────────
FROM node:20-alpine AS production

LABEL org.opencontainers.image.title="microservices-backend"
LABEL org.opencontainers.image.description="Express REST API + PostgreSQL"

# Create non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy dependencies from build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY server.js .

# Own everything as appuser
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

# Liveness/readiness probe uses /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
