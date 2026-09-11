-- mikrotik-quota-monitor schema
-- Run against a fresh Postgres database:
--   psql "$DATABASE_URL" -f schema.sql
-- Safe to re-run: every statement is idempotent. Tables are created first, then
-- indexes, then the migrations that alter earlier releases' tables, so the file
-- works on both an empty database and an existing one.

-- ---------------------------------------------------------------- tables ----

-- Single-row config table. All runtime configuration lives here and is edited
-- through the /settings UI. Only DATABASE_URL, RESEND_API_KEY and CRON_SECRET
-- stay in environment variables.
CREATE TABLE IF NOT EXISTS settings (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  quota_gb            NUMERIC NOT NULL DEFAULT 8 CHECK (quota_gb > 0),
  window_start        TIME NOT NULL DEFAULT '14:00',
  window_end          TIME NOT NULL DEFAULT '23:59',
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  alert_email_to      TEXT,
  -- Name of the WAN interface as the router reports it, e.g. pppoe-out1.
  wan_interface_name  TEXT NOT NULL DEFAULT 'pppoe-out1',
  polling_enabled     BOOLEAN NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One counter sample pushed by the router.
CREATE TABLE IF NOT EXISTS interface_readings (
  id              SERIAL PRIMARY KEY,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  tx_bytes        BIGINT NOT NULL,
  rx_bytes        BIGINT NOT NULL,
  total_bytes     BIGINT GENERATED ALWAYS AS (tx_bytes + rx_bytes) STORED,
  -- The session this sample belongs to, for cross-referencing only.
  session_key     TEXT,
  -- Which interface it came from. Counter deltas are only meaningful within one
  -- interface: without this, changing the WAN interface name would make the next
  -- reading look like a single enormous transfer.
  interface_name  TEXT
);

-- The quota window for one local day, and the counter it is measured from.
CREATE TABLE IF NOT EXISTS daily_windows (
  id                    SERIAL PRIMARY KEY,
  window_date           DATE NOT NULL,
  baseline_bytes        BIGINT NOT NULL,
  baseline_recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified              BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT daily_windows_window_date_key UNIQUE (window_date)
);

-- One WAN link session: a single PPPoE connection, or one period of link-up.
-- tx_bytes/rx_bytes accumulate the traffic of the session; last_tx_counter and
-- last_rx_counter hold the raw interface counters so each sample's delta can be
-- derived even when the counters restart at zero.
CREATE TABLE IF NOT EXISTS sessions (
  id               SERIAL PRIMARY KEY,
  session_key      TEXT NOT NULL,
  interface_name   TEXT,
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,
  end_reason       TEXT,
  last_seen_at     TIMESTAMPTZ NOT NULL,
  tx_bytes         BIGINT NOT NULL DEFAULT 0,
  rx_bytes         BIGINT NOT NULL DEFAULT 0,
  total_bytes      BIGINT GENERATED ALWAYS AS (tx_bytes + rx_bytes) STORED,
  last_tx_counter  BIGINT NOT NULL DEFAULT 0,
  last_rx_counter  BIGINT NOT NULL DEFAULT 0,
  samples          INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ migrations ----
-- For databases created by an earlier release. No-ops on a fresh one.

ALTER TABLE interface_readings ADD COLUMN IF NOT EXISTS session_key TEXT;
ALTER TABLE interface_readings ADD COLUMN IF NOT EXISTS interface_name TEXT;

-- --------------------------------------------------------------- indexes ----

CREATE INDEX IF NOT EXISTS interface_readings_recorded_at_idx
  ON interface_readings (recorded_at DESC);

-- Serves the export's keyset pagination, which walks (recorded_at, id).
CREATE INDEX IF NOT EXISTS interface_readings_recorded_at_id_idx
  ON interface_readings (recorded_at, id);

CREATE INDEX IF NOT EXISTS sessions_started_at_idx ON sessions (started_at DESC);

-- At most one open session, enforced by the database rather than by hope.
CREATE UNIQUE INDEX IF NOT EXISTS sessions_single_open_idx
  ON sessions ((ended_at IS NULL)) WHERE ended_at IS NULL;

-- ------------------------------------------------------------------ seed ----

-- Seed the single settings row. This INSERT is a no-op once the row exists, so
-- editing values on /settings is never undone by re-running this file.
-- alert_email_to is deliberately NULL: a placeholder address would send real
-- alerts to a stranger on a database where /settings was never filled in.
INSERT INTO settings (
  id, quota_gb, window_start, window_end, timezone, alert_email_to,
  wan_interface_name, polling_enabled
) VALUES (
  1, 8, '14:00', '23:59', 'UTC', NULL, 'pppoe-out1', true
)
ON CONFLICT (id) DO NOTHING;

-- Backfill the interface name on readings stored before that column existed.
-- Runs after the seed so the settings row is guaranteed to be there.
UPDATE interface_readings
SET interface_name = (SELECT wan_interface_name FROM settings WHERE id = 1)
WHERE interface_name IS NULL;

-- Readings arrive only by push, so the app never connects to the router and the
-- old router_host/router_user/router_pass columns are no longer used. On a
-- database created before that change, drop them once:
--   ALTER TABLE settings DROP COLUMN IF EXISTS router_host,
--                        DROP COLUMN IF EXISTS router_user,
--                        DROP COLUMN IF EXISTS router_pass;
