-- TryOn — D1 schema v1
-- Apply once with: wrangler d1 execute tryon-db --file=migrations/0001_init.sql
-- (use --remote for production, --local for local dev)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  free_credits_used INTEGER NOT NULL DEFAULT 0,
  paid_credits_balance INTEGER NOT NULL DEFAULT 0,
  daily_used INTEGER NOT NULL DEFAULT 0,
  daily_resets_at INTEGER NOT NULL,
  last_generated_at INTEGER
);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  external_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_external
  ON ledger(external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_user_created
  ON ledger(user_id, created_at);

CREATE TABLE IF NOT EXISTS device_free_credits (
  device_id TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  device_id TEXT,
  user_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);
INSERT OR IGNORE INTO schema_version VALUES (1);
