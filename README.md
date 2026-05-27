# Microservices 3-Tier Application

A production-ready, microservices-based 3-tier web application with a fully automated GitHub Actions **Release Workflow** that builds, versions, packages, and publishes all components on every GitHub Release.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Services](#services)
4. [Release Workflow Deep Dive](#release-workflow-deep-dive)
5. [GitHub Repository Setup](#github-repository-setup)
6. [Local Development](#local-development)
7. [Creating a Release](#creating-a-release)
8. [Release Workflow Execution Flow](#release-workflow-execution-flow)
9. [Docker Image Strategy](#docker-image-strategy)
10. [Release Package Contents](#release-package-contents)
11. [Secrets & Permissions Reference](#secrets--permissions-reference)
12. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                   GitHub Release                  │
│                  (tag: v1.0.0)                    │
└──────────────┬───────────────────────────────────┘
               │  triggers
               ▼
┌──────────────────────────────────────────────────┐
│          GitHub Actions Release Workflow          │
│                                                  │
│  Job 1: extract-version                          │
│    └─ Parse tag → v1.0.0                         │
│                                                  │
│  Job 2: build-and-push (matrix × 3)              │
│    ├─ Build frontend  → GHCR                     │
│    ├─ Build backend   → GHCR                     │
│    └─ Build database  → GHCR                     │
│                                                  │
│  Job 3: package-release                          │
│    └─ ZIP artefact → GitHub Release Asset        │
│                                                  │
│  Job 4: release-notes                            │
│    └─ Update release body + workflow summary     │
└──────────────────────────────────────────────────┘

Runtime (local/prod — NOT done by this workflow):
┌────────────┐     HTTP      ┌──────────────┐     SQL     ┌──────────────┐
│  Frontend  │ ────────────► │  Backend API │ ──────────► │  PostgreSQL  │
│  (Nginx)   │               │  (Express)   │             │  (Database)  │
│  Port 8080 │               │  Port 3000   │             │  Port 5432   │
└────────────┘               └──────────────┘             └──────────────┘
```

---

## Project Structure

```
microservices-app/
├── .github/
│   └── workflows/
│       └── release.yml          ← Main release workflow
├── frontend/
│   ├── index.html               ← Static SPA
│   ├── nginx.conf               ← Nginx server block
│   ├── Dockerfile               ← Multi-stage: node builder → nginx:alpine
│   └── package.json
├── backend/
│   ├── server.js                ← Express REST API
│   ├── Dockerfile               ← Multi-stage: deps → node:alpine (non-root)
│   └── package.json
├── database/
│   ├── init.sql                 ← Schema + seed data
│   └── Dockerfile               ← postgres:15-alpine + init scripts
├── docker-compose.yml           ← Local development
└── README.md
```

---

## Services

### Frontend (`./frontend`)

- **Technology:** HTML5 / Vanilla JS, served by **Nginx 1.25-alpine**
- **Port:** `80` (container) · `8080` (host mapping)
- **Build:** Multi-stage Docker build — static assets copied into Nginx image
- **Features:**
  - Health-check page at `/healthz`
  - Calls backend API for data
  - Security headers via Nginx config

### Backend API (`./backend`)

- **Technology:** **Node.js 20** + **Express 4** + **node-postgres (pg)**
- **Port:** `3000`
- **Build:** Multi-stage Docker build — `npm ci` in builder, copied to production image
- **Security:** Runs as non-root user (`appuser`)
- **Endpoints:**

  | Method | Path         | Description        |
  |--------|--------------|--------------------|
  | GET    | `/health`    | Liveness probe     |
  | GET    | `/items`     | List all items     |
  | POST   | `/items`     | Create item        |
  | GET    | `/items/:id` | Get single item    |
  | DELETE | `/items/:id` | Delete item        |

- **DB Retry Logic:** `connectWithRetry()` — up to 10 attempts with 3 s delay

### Database (`./database`)

- **Technology:** **PostgreSQL 15-alpine**
- **Port:** `5432`
- **Init Script:** `init.sql` auto-runs on first start via `/docker-entrypoint-initdb.d/`
- **Schema:** `items` table + `audit_log` table with seed data

---

## Release Workflow Deep Dive

File: `.github/workflows/release.yml`

### Trigger

```yaml
on:
  release:
    types: [published]
```

The workflow fires **only** when a GitHub Release is published (not drafted or pre-released unless you add those types).

### Concurrency Control

```yaml
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false
```

- Groups concurrent runs by the exact release ref (tag).
- `cancel-in-progress: false` ensures a running release is never killed mid-push.

### Permissions

```yaml
permissions:
  contents: write    # upload release assets
  packages: write    # push to GHCR
  id-token: write    # OIDC (for future cosign signing)
```

Only the minimum set of permissions is granted — no admin or repo-level write access.

### Job 1 — `extract-version`

```
Input:  github.ref_name  (e.g. "v1.0.0")
Output: version          → "v1.0.0"
        version_plain    → "1.0.0"
```

Validates the tag with a strict regex (`^v[0-9]+\.[0-9]+\.[0-9]+$`) and fails fast if the format is wrong.

### Job 2 — `build-and-push` (matrix)

Runs **three parallel jobs** — one per service — using a `strategy.matrix`:

```yaml
matrix:
  include:
    - service: frontend   context: ./frontend   dockerfile: ./frontend/Dockerfile
    - service: backend    context: ./backend    dockerfile: ./backend/Dockerfile
    - service: database   context: ./database   dockerfile: ./database/Dockerfile
```

Each job:

1. **Sets up Docker Buildx** — enables BuildKit, multi-platform support, and layer caching.
2. **Logs in to GHCR** using the auto-provided `GITHUB_TOKEN` (no extra secrets needed).
3. **Generates metadata** via `docker/metadata-action` — produces two tags:
   - `ghcr.io/<owner>/<service>:v1.0.0` ← versioned
   - `ghcr.io/<owner>/<service>:latest`   ← always-current pointer
4. **Builds and pushes** using `docker/build-push-action` with GitHub Actions layer caching (`type=gha`).

#### Why GitHub Actions Cache?

```yaml
cache-from: type=gha,scope=${{ matrix.service }}
cache-to:   type=gha,mode=max,scope=${{ matrix.service }}
```

`mode=max` stores **all** intermediate layers. Subsequent releases with unchanged layers (e.g. the `FROM` base or `npm ci` layer) are retrieved from cache instead of rebuilt, cutting build times by 60–80%.

### Job 3 — `package-release`

Creates a structured ZIP with:

```
release/
├── frontend/                     ← source tree (no node_modules)
├── backend/                      ← source tree
├── database/                     ← init.sql + Dockerfile
├── docker-compose.yml            ← local dev file
├── docker-compose.prod.yml       ← generated with pinned image tags
├── README.md
└── VERSION                       ← single-line: v1.0.0
```

The generated `docker-compose.prod.yml` uses **exact versioned image tags** (e.g. `:v1.0.0`), not `:latest`, so the package is fully reproducible.

Upload uses `actions/upload-release-asset`:

```yaml
upload_url:  ${{ github.event.release.upload_url }}
asset_name:  release-v1.0.0.zip
asset_path:  ./release-v1.0.0.zip
```

### Job 4 — `release-notes`

Uses `actions/github-script` to call the GitHub REST API and **replace the release body** with auto-generated content including:

- Release version + commit SHA
- Table of all image URLs (versioned + latest)
- Copy-pasteable `docker pull` commands
- ZIP download instructions
- Usage snippet

Also writes a **workflow summary** (visible in the Actions run UI) via `$GITHUB_STEP_SUMMARY`.

---

## GitHub Repository Setup

### 1. Create the Repository

```bash
git init microservices-app
cd microservices-app
git remote add origin https://github.com/<your-username>/microservices-app.git
```

### 2. Push the Code

```bash
git add .
git commit -m "Initial commit — microservices 3-tier app"
git push -u origin main
```

### 3. No Secrets Required

`GITHUB_TOKEN` is **automatically injected** by GitHub Actions into every workflow run. You do **not** need to create any repository secrets for this workflow.

> ⚠️ If your repository is inside an **organisation**, ensure the organisation allows GitHub Actions to write packages (`Settings → Actions → General → Workflow permissions → Read and write`).

### 4. Enable GHCR for the Repository

GHCR is enabled by default for all GitHub repositories. Images will be published under:

```
ghcr.io/<your-username>/frontend
ghcr.io/<your-username>/backend
ghcr.io/<your-username>/database
```

After the first push, go to **Packages** on your profile and set visibility to Public if you want unauthenticated pulls.

---

## Local Development

### Prerequisites

| Tool           | Version  |
|----------------|----------|
| Docker         | ≥ 24     |
| Docker Compose | ≥ 2.20   |
| Git            | ≥ 2.40   |

### Start All Services

```bash
# Clone the repo
git clone https://github.com/<your-username>/microservices-app.git
cd microservices-app

# Build images and start containers
docker compose up --build

# Run in background
docker compose up --build -d
```

### Access the Application

| Service      | URL                          |
|--------------|------------------------------|
| Frontend     | http://localhost:8080        |
| Backend API  | http://localhost:3000        |
| Health Check | http://localhost:3000/health |
| PostgreSQL   | localhost:5432               |

### Stop and Clean Up

```bash
# Stop containers
docker compose down

# Stop + remove volumes (wipes DB data)
docker compose down -v
```

### Backend Development (Hot Reload)

```bash
cd backend
npm install
DB_HOST=localhost DB_PORT=5432 DB_NAME=appdb \
  DB_USER=appuser DB_PASSWORD=secret \
  npx nodemon server.js
```

---

## Creating a Release

### Step-by-Step

1. **Push your changes** to the `main` branch.

2. **Go to GitHub → Releases → Draft a new release.**

3. **Create a new tag** following the `vX.Y.Z` format:
   ```
   v1.0.0   ← first release
   v1.1.0   ← minor feature addition
   v2.0.0   ← breaking change
   ```

4. **Fill in the release title and description** (the workflow will append to the body).

5. **Click "Publish release".**

6. **Watch the workflow run** at:
   ```
   https://github.com/<owner>/<repo>/actions
   ```

### Via GitHub CLI

```bash
# Create and publish a release in one command
gh release create v1.0.0 \
  --title "Release v1.0.0" \
  --notes "Initial production release" \
  --latest
```

---

## Release Workflow Execution Flow

```
Developer publishes GitHub Release  (tag: v1.0.0)
                 │
                 ▼
     ┌─────────────────────────┐
     │   Job 1: extract-version │
     │                          │
     │  Validate tag format     │
     │  "v1.0.0" ✓              │
     │                          │
     │  Output:                 │
     │    version      = v1.0.0 │
     │    version_plain = 1.0.0 │
     └──────────┬───────────────┘
                │
                ▼
     ┌──────────────────────────────────────────────────────┐
     │   Job 2: build-and-push  (runs 3 jobs in parallel)   │
     │                                                       │
     │  ┌──────────────┐ ┌─────────────┐ ┌──────────────┐  │
     │  │  frontend    │ │   backend   │ │   database   │  │
     │  │              │ │             │ │              │  │
     │  │ docker buildx│ │docker buildx│ │docker buildx │  │
     │  │   build      │ │  build      │ │  build       │  │
     │  │              │ │             │ │              │  │
     │  │ Push to GHCR │ │Push to GHCR │ │Push to GHCR  │  │
     │  │  :v1.0.0     │ │  :v1.0.0    │ │  :v1.0.0     │  │
     │  │  :latest     │ │  :latest    │ │  :latest     │  │
     │  └──────────────┘ └─────────────┘ └──────────────┘  │
     └──────────────────────────┬───────────────────────────┘
                                │
                                ▼
     ┌──────────────────────────────────────┐
     │   Job 3: package-release             │
     │                                      │
     │  Build release/ directory            │
     │  Generate docker-compose.prod.yml    │
     │  Create release-v1.0.0.zip           │
     │  Upload ZIP → GitHub Release Asset   │
     └──────────────────┬───────────────────┘
                        │
                        ▼
     ┌──────────────────────────────────────┐
     │   Job 4: release-notes              │
     │                                      │
     │  Update GitHub Release body          │
     │  (docker pull commands, image URLs)  │
     │                                      │
     │  Write workflow summary              │
     │  (visible in Actions UI)             │
     └──────────────────────────────────────┘
                        │
                        ▼
           Release Published ✅
```

---

## Docker Image Strategy

### Naming Convention

```
ghcr.io/<github-owner>/<service>:<tag>
```

### Tags Per Release

| Tag       | Example                                   | Purpose                              |
|-----------|-------------------------------------------|--------------------------------------|
| Versioned | `ghcr.io/naveen/frontend:v1.0.0`         | Pinned, reproducible deployments     |
| Latest    | `ghcr.io/naveen/frontend:latest`         | Always points to newest release      |

### Multi-Stage Dockerfiles

All images use multi-stage builds to minimise final image size:

| Service  | Base Image         | Build Stage        | Final Size (approx.) |
|----------|--------------------|--------------------|----------------------|
| frontend | `nginx:1.25-alpine`| `node:20-alpine`   | ~50 MB               |
| backend  | `node:20-alpine`   | `node:20-alpine`   | ~120 MB              |
| database | `postgres:15-alpine` | —               | ~75 MB               |

### Security Practices

- Non-root user in backend (`appuser:appgroup`)
- Minimal base images (`*-alpine` variants)
- No secrets baked into images (all via environment variables)
- `HEALTHCHECK` in every Dockerfile

---

## Release Package Contents

```
release-v1.0.0.zip
└── release/
    ├── frontend/
    │   ├── index.html
    │   ├── nginx.conf
    │   ├── Dockerfile
    │   └── package.json
    ├── backend/
    │   ├── server.js
    │   ├── Dockerfile
    │   └── package.json
    ├── database/
    │   ├── init.sql
    │   └── Dockerfile
    ├── docker-compose.yml          ← Build from source (local dev)
    ├── docker-compose.prod.yml     ← Pull from GHCR  (production)
    ├── README.md
    └── VERSION                     ← Contains "v1.0.0"
```

---

## Secrets & Permissions Reference

### Required Secrets

| Secret         | Source               | Used For             |
|----------------|----------------------|----------------------|
| `GITHUB_TOKEN` | Auto-injected by GHA | GHCR login + release asset upload |

> No manual secrets need to be created. `GITHUB_TOKEN` is always available.

### Required Repository Permissions (Settings → Actions → General)

| Permission       | Setting Required  |
|------------------|-------------------|
| Workflow permissions | **Read and write** |
| Allow GitHub Actions to create and approve pull requests | Optional |

---


---

## Security Scanning — Trivy

Every Docker image is scanned by **[Trivy](https://trivy.dev/)** (by Aqua Security) on every CI run and every release — **before** images are pushed to GHCR.

### Where Trivy Runs

| Workflow | Trigger | Blocks on |
|----------|---------|-----------|
| `ci.yml` | Push to main / Pull Request | CRITICAL vulnerabilities |
| `release.yml` | GitHub Release published | CRITICAL vulnerabilities |

### Scan Policy

```
CRITICAL  → ❌ Workflow fails — image is NOT pushed to GHCR
HIGH      → ⚠️  Reported in logs and Security tab — does not block
MEDIUM    → ⚠️  Reported — does not block
LOW       → ℹ️  Reported in JSON artifact only
Unfixed   → Ignored (no patch available = nothing you can do)
```

### Three Output Formats Per Image

| Format | Where | Purpose |
|--------|-------|---------|
| **Table** | Actions log | Human-readable, instant visibility |
| **SARIF** | GitHub Security → Code scanning alerts | Persistent, searchable, PR annotations |
| **JSON** | Workflow artifact (30-day retention) | Full detail, bundled in release ZIP |

### Viewing Scan Results

**In the Actions log** — every run prints a table like:
```
┌──────────────┬────────────────┬──────────┬──────────────────────┐
│   Library    │ Vulnerability  │ Severity │       Fixed In       │
├──────────────┼────────────────┼──────────┼──────────────────────┤
│ libssl3      │ CVE-2024-XXXX  │ HIGH     │ 3.1.5-r0             │
└──────────────┴────────────────┴──────────┴──────────────────────┘
```

**In the Security tab** — go to your repo → Security → Code scanning alerts:
```
https://github.com/<owner>/<repo>/security/code-scanning
```

**Download JSON reports**:
```
Actions → Select run → Artifacts → trivy-report-<service>-v1.0.0
```

### Suppressing False Positives

Edit `.trivyignore` in the repo root:

```bash
# .trivyignore — one CVE ID per line
CVE-2023-12345    # confirmed false positive — not applicable
CVE-2024-99999    # no fix available, risk accepted (JIRA-456)
```

The ignore file is passed to every Trivy invocation via `trivyignores: ".trivyignore"`.

### Running Trivy Locally

```bash
# Install Trivy
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

# Build an image locally
docker build -t backend:local ./backend

# Quick table scan
trivy image --severity CRITICAL,HIGH backend:local

# Full scan with all severities
trivy image --severity CRITICAL,HIGH,MEDIUM,LOW backend:local

# Scan and output JSON
trivy image --format json --output trivy-backend.json backend:local

# Use the same ignore file as CI
trivy image --ignorefile .trivyignore backend:local
```

### What Happens if a CRITICAL is Found

```
Release tag v1.0.0 created
      ↓
Build frontend image ✅
Trivy scan frontend  ✅  (0 CRITICAL)
      ↓
Build backend image  ✅
Trivy scan backend   ❌  (1 CRITICAL found — CVE-2024-XXXXX in libcrypto)
      ↓
Workflow FAILS — backend image is NOT pushed to GHCR
Release asset is NOT uploaded
Release notes are NOT updated
```

**How to fix:** Update the base image or the vulnerable package, commit, delete the release, and re-publish it:

```bash
# In backend/Dockerfile, pin to a patched base image version:
# FROM node:20.15-alpine   ← pinned to patched version

git add backend/Dockerfile
git commit -m "fix: bump node base image to patch CVE-2024-XXXXX"
git push

# Delete the bad release and recreate
gh release delete v1.0.0 --yes
git push origin --delete v1.0.0
gh release create v1.0.0 --title "Release v1.0.0" --notes "Patched CVE-2024-XXXXX" --latest
```


---

## Troubleshooting

### Workflow doesn't trigger

- Confirm the release was **Published** (not saved as Draft).
- Check the tag format: must be `vX.Y.Z` (the workflow validates this).

### GHCR push fails with 403

```
Error: denied: permission_denied: write_package
```

Go to **Settings → Actions → General → Workflow permissions** and set to **Read and write**.

### Image not publicly visible

After the first push, visit `https://github.com/<owner>?tab=packages`, click the package, and set visibility to **Public** under Package Settings.

### `upload-release-asset` fails

Ensure the `upload_url` is present — this comes from `github.event.release.upload_url`. This is only available when the trigger is `release: [published]`, not `push`.

### Build cache miss on first run

The first run always builds from scratch. Cache is warm from the second run onwards. Expect the first release to take 3–5 minutes; subsequent ones 1–2 minutes.

---

## License

MIT — see [LICENSE](LICENSE) for details.
