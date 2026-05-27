# Custom PostgreSQL image with schema pre-baked.
# Upgraded to postgres:16-alpine (Alpine 3.23, active support).
# postgres:15-alpine had patchable CRITICAL vulnerabilities in Alpine packages.
FROM postgres:16-alpine

LABEL org.opencontainers.image.title="microservices-database"
LABEL org.opencontainers.image.description="PostgreSQL 16 with application schema"

# Apply all available Alpine security patches at build time.
# This ensures any CVEs fixed after the base image was published are included.
RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*

# Copy initialisation scripts into the official hook directory.
# PostgreSQL runs *.sql files here on first start (alphabetical order).
COPY init.sql /docker-entrypoint-initdb.d/01-init.sql

EXPOSE 5432

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" || exit 1
