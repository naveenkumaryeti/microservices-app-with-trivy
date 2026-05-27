-- ──────────────────────────────────────────────────────────────────
-- Database initialisation script
-- Runs automatically when the PostgreSQL container starts for the
-- first time (mounted at /docker-entrypoint-initdb.d/)
-- ──────────────────────────────────────────────────────────────────

-- Create application database (POSTGRES_DB env var already creates
-- the primary DB, this script adds schema + seed data)

-- Items table
CREATE TABLE IF NOT EXISTS items (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed data for local development / smoke tests
INSERT INTO items (name, description) VALUES
  ('Sample Item 1', 'Auto-seeded on first run'),
  ('Sample Item 2', 'Another seeded item');

-- Audit log table (demonstrates a second table)
CREATE TABLE IF NOT EXISTS audit_log (
    id         SERIAL PRIMARY KEY,
    action     VARCHAR(50)  NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    record_id  INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
