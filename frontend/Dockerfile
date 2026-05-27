# ─────────────────────────────────────────────
# Stage 1: Build (kept minimal — static site)
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
# Use npm ci if lockfile present, otherwise npm install (or skip if no package.json)
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; \
    elif [ -f package.json ]; then npm install --omit=dev; fi
COPY . .

# ─────────────────────────────────────────────
# Stage 2: Production — Nginx static server
# ─────────────────────────────────────────────
FROM nginx:1.25-alpine

LABEL org.opencontainers.image.title="microservices-frontend"
LABEL org.opencontainers.image.description="Nginx static frontend"

# Remove default Nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy built assets
COPY --from=builder /app/index.html /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
