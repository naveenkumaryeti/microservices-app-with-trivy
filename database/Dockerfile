# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: Rebuild gosu with a patched Go version
# ──────────────────────────────────────────────────────────────────────────────
# The official postgres:alpine image ships /usr/local/bin/gosu compiled with
# Go 1.18.2, which contains multiple CRITICAL CVEs in the Go stdlib
# (CVE-2024-24790, CVE-2023-24540, CVE-2023-24538, etc.).
#
# gosu's security policy explicitly states they do not update Go for stdlib
# CVEs (https://github.com/tianon/gosu/blob/master/SECURITY.md), so the only
# fix is to rebuild the binary ourselves with a patched Go version.
#
# This stage builds gosu from the official source using Go 1.24-alpine,
# which resolves all known stdlib CRITICAL CVEs.
# ──────────────────────────────────────────────────────────────────────────────
FROM golang:1.24-alpine AS gosu-builder

# Install build dependencies
RUN apk add --no-cache git

# Build gosu from source using patched Go 1.24
# Pin to the latest gosu release tag for reproducibility
ARG GOSU_VERSION=1.17
RUN git clone --depth 1 --branch ${GOSU_VERSION} \
      https://github.com/tianon/gosu.git /src/gosu \
    && cd /src/gosu \
    && CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /usr/local/bin/gosu . \
    && gosu --version \
    && gosu nobody true

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: Final production image
# ──────────────────────────────────────────────────────────────────────────────
FROM postgres:16.12-alpine

LABEL org.opencontainers.image.title="microservices-database"
LABEL org.opencontainers.image.description="PostgreSQL 16.12 — gosu rebuilt with Go 1.24 to patch stdlib CVEs"

# Apply all Alpine OS-level security patches
RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*

# Replace the vulnerable gosu binary with our patched build
COPY --from=gosu-builder /usr/local/bin/gosu /usr/local/bin/gosu
RUN chmod +x /usr/local/bin/gosu \
    && gosu --version \
    && gosu nobody true

# Copy initialisation scripts.
# PostgreSQL runs *.sql files in /docker-entrypoint-initdb.d/ on first start.
COPY init.sql /docker-entrypoint-initdb.d/01-init.sql

EXPOSE 5432

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" || exit 1
