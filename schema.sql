-- mikrotik-quota-monitor schema
-- Run against a fresh Postgres database:
--   psql "$DATABASE_URL" -f schema.sql
-- Safe to re-run: every statement is idempotent. Tables are created first, then
-- indexes, then the migrations that alter earlier releases' tables, so the file
-- works on both an empty database and an existing one.

-- ---------------------------------------------------------------- tables ----

-- Single-row config table. All runtime configuration lives here and is edited
-- through the /settings UI. Only DATABASE_URL, RESEND_API_KEY and CRON_SECRET
-- stay in environment variables. Accounts live in `users` further down.
CREATE TABLE IF NOT EXISTS settings (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  quota_gb            NUMERIC NOT NULL DEFAULT 8 CHECK (quota_gb > 0),
  -- Cap for a whole billing cycle, independent of the daily window quota.
  monthly_quota_gb    NUMERIC NOT NULL DEFAULT 600 CHECK (monthly_quota_gb > 0),
  -- Day of the month the billing cycle rolls over on. Clamped to the last day
  -- of shorter months by the application, so 31 is a valid choice.
  billing_cycle_day   INTEGER NOT NULL DEFAULT 5 CHECK (billing_cycle_day BETWEEN 1 AND 31),
  window_start        TIME NOT NULL DEFAULT '14:00',
  window_end          TIME NOT NULL DEFAULT '23:59',
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  alert_email_to      TEXT,
  -- Name of the WAN interface as the router reports it, e.g. pppoe-out1.
  wan_interface_name  TEXT NOT NULL DEFAULT 'pppoe-out1',
  polling_enabled     BOOLEAN NOT NULL DEFAULT true,
  -- Language quota alerts are written in. The pages take their language from
  -- the URL instead; an alert is sent with no request behind it, so its
  -- language has to be a stored setting rather than a header.
  language            TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ar')),
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

-- ------------------------------------------------------------- accounts ----

-- Who may sign in. The seed below creates one account; there is no sign-up.
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  username       TEXT NOT NULL,
  -- Where a password-reset link is sent. Optional: when NULL the reset falls
  -- back to settings.alert_email_to, which on a single-owner install is the
  -- same person.
  email          TEXT,
  -- scrypt, formatted as scrypt$N$r$p$salt$hash. See lib/auth/password.ts.
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_username_key UNIQUE (username)
);

-- One signed-in browser. Both tokens are stored hashed (SHA-256), so a copy of
-- this table cannot be replayed. The access token is short-lived and is what
-- every request presents; the refresh token is long-lived and only ever mints
-- a new access token. Logging out sets revoked_at, which kills both at once.
-- Named auth_sessions because `sessions` already holds WAN link sessions.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  access_token_hash   TEXT NOT NULL,
  refresh_token_hash  TEXT NOT NULL,
  access_expires_at   TIMESTAMPTZ NOT NULL,
  refresh_expires_at  TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at          TIMESTAMPTZ,
  user_agent          TEXT,
  ip                  TEXT,
  CONSTRAINT auth_sessions_access_token_hash_key  UNIQUE (access_token_hash),
  CONSTRAINT auth_sessions_refresh_token_hash_key UNIQUE (refresh_token_hash)
);

-- A "forgot password" link. Single use, one hour.
CREATE TABLE IF NOT EXISTS password_resets (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT password_resets_token_hash_key UNIQUE (token_hash)
);

-- One row per scheduled job, written by /api/cron/tick after every run. The
-- tick may be called every minute; each job reads its own state (this row,
-- the alerts log) to decide whether there is anything to do.
CREATE TABLE IF NOT EXISTS job_runs (
  job          TEXT PRIMARY KEY,
  last_run_at  TIMESTAMPTZ NOT NULL,
  last_status  TEXT NOT NULL,
  last_detail  TEXT
);

-- ------------------------------------------------------------ migrations ----
-- For databases created by an earlier release. No-ops on a fresh one.

ALTER TABLE interface_readings ADD COLUMN IF NOT EXISTS session_key TEXT;
ALTER TABLE interface_readings ADD COLUMN IF NOT EXISTS interface_name TEXT;

-- Monthly cap and its cycle day. Existing rows pick up the defaults, so a
-- database upgraded from an earlier release starts on a 600 GB cycle that
-- rolls over on the 5th until /settings says otherwise.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS monthly_quota_gb  NUMERIC NOT NULL DEFAULT 600;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_cycle_day INTEGER NOT NULL DEFAULT 5;

-- Alert language. A database upgraded from an earlier release keeps sending
-- English alerts until /settings says otherwise.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';

-- Per-device accounting (plan 05). Off by default: it needs a router-side
-- script and, on this router, fasttrack disabled, which is a cost the owner
-- chooses on /settings.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS devices_enabled BOOLEAN NOT NULL DEFAULT false;

-- One row per LAN device the router has ever reported. `name` is what the
-- owner typed on /devices; NULL falls back to the last DHCP hostname, then
-- to the MAC itself.
CREATE TABLE IF NOT EXISTS devices (
  mac         TEXT PRIMARY KEY,
  name        TEXT,
  hostname    TEXT,
  ip          TEXT,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One counter sample per device per push. The counters are cumulative as the
-- router reports them (kid-control bytes-up / bytes-down); usage is the growth
-- between consecutive rows of one MAC, like interface_readings.
CREATE TABLE IF NOT EXISTS device_readings (
  id           SERIAL PRIMARY KEY,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  mac          TEXT NOT NULL REFERENCES devices (mac) ON DELETE CASCADE,
  tx_bytes     BIGINT NOT NULL,
  rx_bytes     BIGINT NOT NULL
);

-- Scheduled checks (plan 02). stale_after_minutes = 0 disables the
-- "router has gone quiet" alert. digest picks the scheduled summary.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS stale_after_minutes INTEGER NOT NULL DEFAULT 10;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS digest TEXT NOT NULL DEFAULT 'weekly';

-- Alert marks. Percent of the daily quota (and of the monthly cap) at which a
-- mail goes out. 100 is the "exceeded" alert that has always existed; the
-- defaults add two earlier warnings. Sorted ascending, each 1..100, unique.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS alert_thresholds       INTEGER[] NOT NULL DEFAULT '{50,80,100}';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS cycle_alert_thresholds INTEGER[] NOT NULL DEFAULT '{80,100}';
-- One mail per cycle when the projection first says the cap will be exhausted.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS cycle_pace_alert       BOOLEAN NOT NULL DEFAULT true;

-- The highest threshold percent already mailed for the day. `notified` stays
-- for older queries and is true exactly when notified_level >= 100.
ALTER TABLE daily_windows ADD COLUMN IF NOT EXISTS notified_level INTEGER NOT NULL DEFAULT 0;
UPDATE daily_windows SET notified_level = 100 WHERE notified AND notified_level < 100;

-- Every alert ever sent, failed or skipped, one row each. `channel` exists so a
-- second channel can be added later without a migration.
CREATE TABLE IF NOT EXISTS alerts (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  level       INTEGER,
  scope_key   TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'email',
  recipient   TEXT,
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error       TEXT,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-cycle alert state, keyed by the local date the cycle began.
CREATE TABLE IF NOT EXISTS cycle_alerts (
  cycle_start     DATE PRIMARY KEY,
  notified_level  INTEGER NOT NULL DEFAULT 0,
  pace_notified   BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CHECK constraints have no IF NOT EXISTS, so add them only when missing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_monthly_quota_gb_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_monthly_quota_gb_check
      CHECK (monthly_quota_gb > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_billing_cycle_day_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_billing_cycle_day_check
      CHECK (billing_cycle_day BETWEEN 1 AND 31);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_language_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_language_check
      CHECK (language IN ('en', 'ar'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_alert_thresholds_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_alert_thresholds_check
      CHECK (cardinality(alert_thresholds) BETWEEN 0 AND 8);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_cycle_alert_thresholds_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_cycle_alert_thresholds_check
      CHECK (cardinality(cycle_alert_thresholds) BETWEEN 0 AND 8);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_stale_after_minutes_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_stale_after_minutes_check
      CHECK (stale_after_minutes BETWEEN 0 AND 1440);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_digest_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_digest_check
      CHECK (digest IN ('off', 'weekly', 'cycle'));
  END IF;
END
$$;

-- --------------------------------------------------------------- indexes ----

CREATE INDEX IF NOT EXISTS interface_readings_recorded_at_idx
  ON interface_readings (recorded_at DESC);

-- Serves the export's keyset pagination, which walks (recorded_at, id).
CREATE INDEX IF NOT EXISTS interface_readings_recorded_at_id_idx
  ON interface_readings (recorded_at, id);

-- Every statistic derives its deltas from a LAG window partitioned by interface
-- and ordered by (recorded_at, id). This index matches that order exactly, so
-- the window runs off an index scan instead of sorting the whole range.
CREATE INDEX IF NOT EXISTS interface_readings_interface_recorded_idx
  ON interface_readings (interface_name, recorded_at, id);

CREATE INDEX IF NOT EXISTS sessions_started_at_idx ON sessions (started_at DESC);

-- At most one open session, enforced by the database rather than by hope.
CREATE UNIQUE INDEX IF NOT EXISTS sessions_single_open_idx
  ON sessions ((ended_at IS NULL)) WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets (user_id);

CREATE INDEX IF NOT EXISTS alerts_created_at_idx ON alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_kind_scope_idx ON alerts (kind, scope_key);

-- Every per-device statistic takes deltas within one MAC in (recorded_at, id)
-- order; this index serves that window directly.
CREATE INDEX IF NOT EXISTS device_readings_mac_recorded_idx
  ON device_readings (mac, recorded_at, id);
CREATE INDEX IF NOT EXISTS device_readings_recorded_at_idx
  ON device_readings (recorded_at DESC);

-- ------------------------------------------------------------------ seed ----

-- Seed the single settings row. This INSERT is a no-op once the row exists, so
-- editing values on /settings is never undone by re-running this file.
-- alert_email_to is deliberately NULL: a placeholder address would send real
-- alerts to a stranger on a database where /settings was never filled in.
INSERT INTO settings (
  id, quota_gb, monthly_quota_gb, billing_cycle_day, window_start, window_end,
  timezone, alert_email_to, wan_interface_name, polling_enabled, language
) VALUES (
  1, 8, 600, 5, '14:00', '23:59', 'UTC', NULL, 'pppoe-out1', true, 'en'
)
ON CONFLICT (id) DO NOTHING;

-- Seed the first account: username bilalnasr, password admin123 (stored as an
-- scrypt hash with a fixed salt, so re-running this file yields the same row).
-- Change the password from /settings as soon as the app is reachable by anyone
-- but you. A no-op once any user exists, so a changed password is never undone.
INSERT INTO users (username, email, password_hash)
SELECT 'bilalnasr', NULL,
       'scrypt$16384$8$1$cXVvdGEtbW9uaXRvci1zZWVk$yMXSIcsj4xKiN0h6biQqvOmyM3jipC20hCWReHtRCkaqQWIg/ymzm9AEU38c5UzIWxR2G0+Mqlw2TZQqb9pwtw=='
WHERE NOT EXISTS (SELECT 1 FROM users);

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
