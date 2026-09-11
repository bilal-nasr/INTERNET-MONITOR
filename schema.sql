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

-- Single-row config table. All runtime configuration lives here and is edited
-- through the /settings UI. Only DATABASE_URL, RESEND_API_KEY, CRON_SECRET and
-- a few other deploy-time secrets stay in environment variables.
CREATE TABLE IF NOT EXISTS settings (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  quota_gb            NUMERIC NOT NULL DEFAULT 8 CHECK (quota_gb > 0),
  window_start        TIME NOT NULL DEFAULT '14:00',
  window_end          TIME NOT NULL DEFAULT '23:59',
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  alert_email_to      TEXT,
  wan_interface_name  TEXT NOT NULL DEFAULT 'ISP-ether1',
  router_host         TEXT,
  router_user         TEXT,
  -- Stored in plaintext. Only ever read server-side and never returned to the
  -- browser, but anyone with database access can read it. See README.
  router_pass         TEXT,
  polling_enabled     BOOLEAN NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the single settings row with the same defaults as .env.local.example.
-- Edit these afterwards from the /settings page; this INSERT is a no-op once
-- the row exists.
INSERT INTO settings (
  id, quota_gb, window_start, window_end, timezone, alert_email_to,
  wan_interface_name, router_host, router_user, router_pass, polling_enabled
) VALUES (
  1, 8, '14:00', '23:59', 'UTC', 'me@example.com',
  'ISP-ether1', 'https://your-hostname.sn.mynetname.net', 'api-readonly', 'changeme', true
)
ON CONFLICT (id) DO NOTHING;
