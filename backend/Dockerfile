# ─────────────────────────────────────────────
# Stage 1: Install dependencies
# ─────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests first to leverage Docker layer cache
COPY package.json ./
# Use npm install — lockfile is generated fresh inside the container.
# This avoids stub/stale package-lock.json sync errors in CI.
# Once you have a real lockfile committed, replace with: npm ci --omit=dev
RUN npm install --omit=dev

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
