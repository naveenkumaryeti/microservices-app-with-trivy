# Custom PostgreSQL image with schema pre-baked
# Inherits from official postgres image and adds init scripts
FROM postgres:15-alpine

LABEL org.opencontainers.image.title="microservices-database"
LABEL org.opencontainers.image.description="PostgreSQL 15 with application schema"

# Copy initialisation scripts into the official hook directory.
# PostgreSQL runs *.sql files here on first start (alphabetical order).
COPY init.sql /docker-entrypoint-initdb.d/01-init.sql

# Expose standard PostgreSQL port
EXPOSE 5432

# Healthcheck via pg_isready
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" || exit 1
