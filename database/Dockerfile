# ──────────────────────────────────────────────────────────────────────────────
# PostgreSQL database image with application schema pre-baked.
#
# Base image: postgres:16.12-alpine
#   - postgres:16-alpine (floating tag) shipped postgresql16 < 16.12-r0
#     which contains CVE-2026-2005 (heap buffer overflow in pgcrypto, CRITICAL)
#   - postgres:16.12-alpine pins to PostgreSQL 16.12, which ships
#     postgresql16 >= 16.12-r0 on Alpine 3.23 — the CVE is patched here.
#   - Fixed in: postgresql16-16.12-r0 (Alpine OSV ALPINE-CVE-2026-2005)
# ──────────────────────────────────────────────────────────────────────────────
FROM postgres:16.12-alpine

LABEL org.opencontainers.image.title="microservices-database"
LABEL org.opencontainers.image.description="PostgreSQL 16.12 with application schema"

# Upgrade all Alpine packages to pick up any security patches released
# after the base image was last published.
RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*

# Copy initialisation scripts.
# PostgreSQL runs *.sql files in /docker-entrypoint-initdb.d/ on first start.
COPY init.sql /docker-entrypoint-initdb.d/01-init.sql

EXPOSE 5432

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" || exit 1
