-- mikrotik-quota-monitor schema
-- Run against a fresh Postgres database (e.g. Neon):
--   psql "$DATABASE_URL" -f schema.sql
-- Safe to re-run: every statement is idempotent.

CREATE TABLE IF NOT EXISTS interface_readings (
  id           SERIAL PRIMARY KEY,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  tx_bytes     BIGINT NOT NULL,
  rx_bytes     BIGINT NOT NULL,
  total_bytes  BIGINT GENERATED ALWAYS AS (tx_bytes + rx_bytes) STORED
);

CREATE INDEX IF NOT EXISTS interface_readings_recorded_at_idx
  ON interface_readings (recorded_at DESC);

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

CREATE INDEX IF NOT EXISTS sessions_started_at_idx ON sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_open_idx ON sessions (ended_at) WHERE ended_at IS NULL;

-- Link each reading back to the session it belongs to (added after the first
-- release, so it is a separate ALTER rather than part of the CREATE above).
ALTER TABLE interface_readings ADD COLUMN IF NOT EXISTS session_key TEXT;

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

-- Seed the single settings row with the same defaults as .env.local.example.
-- Edit these afterwards from the /settings page; this INSERT is a no-op once
-- the row exists.
INSERT INTO settings (
  id, quota_gb, window_start, window_end, timezone, alert_email_to,
  wan_interface_name, polling_enabled
) VALUES (
  1, 8, '14:00', '23:59', 'UTC', 'me@example.com', 'pppoe-out1', true
)
ON CONFLICT (id) DO NOTHING;

-- Readings arrive only by push, so the app never connects to the router and the
-- old router_host/router_user/router_pass columns are no longer used. On a
-- database created before that change, drop them once:
--   ALTER TABLE settings DROP COLUMN IF EXISTS router_host,
--                        DROP COLUMN IF EXISTS router_user,
--                        DROP COLUMN IF EXISTS router_pass;
