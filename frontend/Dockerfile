# ─────────────────────────────────────────────
# Stage 1: Builder (kept for future tooling)
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY . .
# No npm dependencies — pure static HTML/JS served by Nginx.

# ─────────────────────────────────────────────
# Stage 2: Production — Nginx static server
# Upgraded to nginx:1.27-alpine (Alpine 3.23, active support)
# nginx:1.25-alpine used EOL Alpine 3.19 which had patchable CRITICALs.
# ─────────────────────────────────────────────
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="microservices-frontend"
LABEL org.opencontainers.image.description="Nginx static frontend"

# Apply all available Alpine security patches at build time.
# This ensures any CVEs fixed after the base image was published are included.
RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*

# Remove default Nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy built assets
COPY --from=builder /app/index.html /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
