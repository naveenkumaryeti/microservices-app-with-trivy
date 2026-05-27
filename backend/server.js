'use strict';

/**
 * Backend API — Express + PostgreSQL
 * Endpoints:
 *   GET  /health        — liveness + DB connectivity check
 *   GET  /items         — list all items
 *   POST /items         — create an item  { name, description }
 *   GET  /items/:id     — get single item
 *   DELETE /items/:id   — delete item
 */

const express = require('express');
const { Pool }  = require('pg');
const cors      = require('cors');
const helmet    = require('helmet');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());

// ── Database pool ─────────────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST     || 'database',
  port:     Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME     || 'appdb',
  user:     process.env.DB_USER     || 'appuser',
  password: process.env.DB_PASSWORD || 'secret',
  // Production-grade pool settings
  max:              10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// ── DB initialisation with retry ─────────────────────────────────────────────
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3_000;

async function connectWithRetry(attempt = 1) {
  try {
    const client = await pool.connect();
    // Create table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS items (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        description TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    client.release();
    console.log(`✅  Connected to PostgreSQL (attempt ${attempt})`);
  } catch (err) {
    if (attempt >= MAX_RETRIES) {
      console.error('❌  Could not connect to DB after max retries:', err.message);
      process.exit(1);
    }
    console.warn(`⏳  DB not ready (attempt ${attempt}/${MAX_RETRIES}) — retrying in ${RETRY_DELAY_MS}ms`);
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    return connectWithRetry(attempt + 1);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check — used by Kubernetes readiness/liveness probes
app.get('/health', async (_req, res) => {
  let dbStatus = 'unreachable';
  try {
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch { /* ignore */ }

  const healthy = dbStatus === 'connected';
  res.status(healthy ? 200 : 503).json({
    status:   healthy ? 'ok' : 'degraded',
    database: dbStatus,
    version:  process.env.APP_VERSION || 'dev',
    uptime:   Math.floor(process.uptime()),
  });
});

// List all items
app.get('/items', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM items ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Create item
app.post('/items', async (req, res) => {
  const { name, description } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO items (name, description) VALUES ($1, $2) RETURNING *',
      [name.trim(), description?.trim() || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

// Get single item
app.get('/items/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch item' });
  }
});

// Delete item
app.delete('/items/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rowCount } = await pool.query('DELETE FROM items WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ─────────────────────────────────────────────────────────────────────
connectWithRetry().then(() => {
  app.listen(PORT, () => console.log(`🚀  Backend API listening on port ${PORT}`));
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received — shutting down gracefully');
  await pool.end();
  process.exit(0);
});
