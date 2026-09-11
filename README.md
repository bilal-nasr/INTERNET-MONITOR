# mikrotik-quota-monitor

Tracks home internet usage from a MikroTik router, stores the history in Postgres, and emails you when usage inside a daily time window exceeds a quota. It also records every WAN link session, so you can see how long each connection lasted and how much it carried.

The router pushes its counters to the app. The app never connects to the router, which is what makes this work behind carrier-grade NAT where the router has no reachable public address.

Stack: Next.js 16 (App Router, TypeScript), Postgres via `pg-promise`, Resend for email, Recharts, Tailwind. Package manager is pnpm. Ships as a Docker image.

## Security warning: read this first

There is **no authentication**. Everyone who can reach the app can read your traffic history, download it from `/export`, and change the quota and alert address on `/settings`. That is fine on a home LAN. Before exposing it to the internet, put something in front of it: a reverse proxy with basic auth, your host's built-in password protection, or a login page plus a `proxy.ts` cookie check.

The one secret that matters is `CRON_SECRET`. It is the bearer token the router sends, and it is the only thing stopping anyone from injecting fake readings.

## How it works

Every minute the router runs a small script (`router/quota-push.rsc`) that reads the WAN interface counters and POSTs them to `/api/ingest` with `Authorization: Bearer $CRON_SECRET`. For each reading the app:

1. Reads the single row of the `settings` table. If `polling_enabled` is false the reading is discarded.
2. Stores the counters in `interface_readings`.
3. Updates the current session in `sessions`, or starts a new one if the link reconnected.
4. If the local time (in `settings.timezone`) is inside `window_start`-`window_end`:
   - creates today's `daily_windows` row on the first reading, using the current total as the baseline;
   - computes usage since the baseline by summing the deltas between consecutive readings;
   - if usage exceeds `quota_gb * 1e9` bytes and today's row is not yet `notified`, emails `alert_email_to` and marks the row.
5. Outside the window it only records the reading.

Quota is decimal gigabytes: 8 GB = 8,000,000,000 bytes.

### Session accounting

A PPPoE interface restarts its counters at zero on every reconnect, so totalling the raw counter would lose traffic on each drop. Instead each session row keeps both the last raw counter and a running total, and adds `counter - last_counter` per sample, or the whole counter when it went backwards.

A new session starts when the router reports a different session id, or when the counters go backwards, which catches a reconnect the router never got to report.

Timestamps come from the server clock, except the moment the link came up, which only the router knows. Since `link_up` and `router_time` are read from the same clock, the difference between `router_time` and the server clock is subtracted from `link_up`, so the timeline stays correct even if the router's clock is wrong. Start times are clamped so sessions can never overlap or show a negative offline gap. When the router reports no link-up time at all, the start is inferred from the earliest reading of the current counter run.

The known limit: traffic between the last sample and an unexpected drop cannot be recovered, so a session can under-report by up to one polling interval.

## Setup

### 1. Database

Any Postgres works. Run `schema.sql` once; it is idempotent and seeds the settings row.

```bash
psql "$DATABASE_URL" -f schema.sql
```

**Supabase**: its pooler presents a certificate signed by Supabase's private CA, which Node does not trust. That root certificate is bundled in `lib/certs.ts`, so set `DATABASE_SSL_CA=supabase` and use the transaction pooler:

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres
DATABASE_SSL_CA=supabase
```

The app uses no prepared statements or session state, so transaction pooling is safe. `DATABASE_SSL_CA` also accepts any other PEM inline, `DATABASE_SSL=no-verify` skips verification, and `DATABASE_SSL=disable` turns TLS off for a local database.

**Neon** and other public-CA hosts need neither variable.

### 2. Run the app

```bash
cp .env.local.example .env.local   # fill in DATABASE_URL, RESEND_API_KEY, CRON_SECRET
pnpm install
pnpm dev
```

Or with Docker, which is how it is meant to run in production:

```bash
docker compose up --build
```

Open `/settings` and set the timezone, quota, window, alert email and the WAN interface name.

### 3. Email (Resend)

Create an API key at <https://resend.com>. For real delivery, verify a domain and set `ALERT_EMAIL_FROM` to an address on it. Without a verified domain, `onboarding@resend.dev` works but only delivers to the address that owns the Resend account. The "Send test email" button on `/settings` confirms the setup.

### 4. The router script

In WinBox:

1. **System > Scripts**, click **+**. Name it `quota-push`, paste everything below the dashed line in [`router/quota-push.rsc`](router/quota-push.rsc) into **Source**, keep the default policies, click OK.
2. Edit the three values at the top:
   - `iface` - your WAN interface name. Check **Interfaces**; with PPPoE it is usually `pppoe-out1`, not the physical port, because that is where the session counters live.
   - `url` - `http://<app-host>:3000/api/ingest`
   - `secret` - the same string as `CRON_SECRET`
3. **System > Scheduler**, click **+**: name `quota-push`, start time `startup`, interval `00:01:00`, on event `/system script run quota-push`.
4. Select the script and click **Run Script**. **Log** should show `quota-push: sent tx=... rx=...` and a reading should appear on the dashboard within seconds.

Set the same interface name on `/settings` so the dashboard labels it correctly.

The script reports `session_start`, `session_end` and `session_restart` alongside each sample, which is what fills the `/sessions` page. A failed POST is retried on the next run rather than lost.

#### When the router says the POST failed

The router's own log tells you which problem you have:

| Log message | Meaning |
| --- | --- |
| `Host is unreachable` | Wrong or stale address. Check the app host's current IP; DHCP may have changed it. |
| `timeout connecting` | The address is routable but nothing answers. Usually a firewall on the app host, or no route back. |
| `POST ... failed` with no fetch error | The app answered with an error status. Check the app's log. |

Run `/ping <app-host>` and `/tool fetch url="http://<app-host>:3000/api/health" output=user` from the router's terminal to separate a network problem from an app problem.

On Windows, the host firewall blocks inbound connections to the dev server by default. Allow the port once, from an elevated PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Quota monitor 3000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private
```

Give the app host a static address or a DHCP reservation, otherwise its IP will change and the script will point at nothing.

## API

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/ingest` | Requires `Authorization: Bearer $CRON_SECRET`. Body `{ "tx_bytes", "rx_bytes", "iface"?, "running"?, "session_id"?, "link_up"?, "router_time"? }` as JSON or form-encoded. |
| `GET` | `/api/health` | `200` when the database is reachable, `503` otherwise. Used by the container health check. |
| `GET` | `/api/usage/today` | Today's readings, baseline, `used_since_baseline`, quota and window state. |
| `GET` | `/api/usage/history?days=30` | Per-day min, max, reboot-aware usage and reading count. Max 365 days. |
| `GET` | `/api/sessions?days=30&limit=200` | Link sessions with uptime, offline gap and traffic, plus totals. |
| `GET` | `/api/settings` | Current settings. |
| `PUT` | `/api/settings` | Any subset of fields. Validates quota > 0, `window_end` after `window_start`, email format and IANA timezone. |
| `GET` | `/api/export?format=csv\|json&from=YYYY-MM-DD&to=YYYY-MM-DD` | Streams readings in the range, dates inclusive, in the configured timezone. |
| `POST` | `/api/test-email` | Sends a test email to `alert_email_to`. |

## Docker

The image is a multi-stage build producing the Next.js standalone server, running as a non-root user, with no secrets baked in.

```bash
docker build -t mikrotik-quota-monitor .
docker run --rm -p 3000:3000 --env-file .env.local mikrotik-quota-monitor
```

Or with compose, which also offers a bundled Postgres:

```bash
docker compose up --build                      # app only, using DATABASE_URL from .env.local
docker compose --profile local-db up --build   # app plus a Postgres container
```

With the `local-db` profile, point `.env.local` at the bundled database and `schema.sql` is applied automatically on first start:

```
DATABASE_URL=postgres://quota:quota@db:5432/quota
DATABASE_SSL=disable
```

### Deploying to a host such as Sevalla

Point the platform at this repository with the Dockerfile as the build source. Set `DATABASE_URL`, `RESEND_API_KEY`, `CRON_SECRET`, `ALERT_EMAIL_FROM` and, for Supabase, `DATABASE_SSL_CA=supabase` as environment variables. The server binds `0.0.0.0` and honours the `PORT` variable the platform injects. Use `/api/health` as the health check path.

Then change the `url` line in the router script to the deployed address. Nothing else moves, because all other configuration lives in the database.

## Project layout

```
app/
  page.tsx               dashboard, auto-refreshing
  sessions/page.tsx      link sessions with uptime and per-session traffic
  settings/page.tsx      settings form
  export/page.tsx        date range export
  api/...                route handlers listed above
components/              UI pieces
lib/
  db.ts                  pg-promise pool, type parsers and TLS selection
  certs.ts               bundled Supabase root CA
  settings.ts            settings read and upsert
  readings.ts            stores a reading and applies the quota window logic
  sessions.ts            link session tracking and reporting
  usage.ts               reading queries, reboot-aware usage math, daily history
  email.ts               Resend alerts
  time.ts                timezone, window and duration helpers
router/quota-push.rsc    the RouterOS script
schema.sql               tables and the settings seed
Dockerfile               production image
docker-compose.yml       local run, optionally with Postgres
```

## Notes and limits

- Timezone (`settings.timezone`, an IANA name such as `Asia/Beirut`) decides which day a reading belongs to and when the window opens. The seed value is `UTC`.
- The window cannot cross midnight: `window_end` must be after `window_start`.
- One alert per day. To re-arm after testing: `UPDATE daily_windows SET notified = false WHERE window_date = CURRENT_DATE;`
- If the email send fails, the request returns 502 and `notified` stays false, so the next reading retries.
- The dashboard refreshes every 15 seconds and the sessions page every 20, pausing while the browser tab is hidden. Click the "Live" pill to refresh immediately.
- Today's usage and the session totals measure different things. Today's usage is bounded by the quota window; session totals cover whole connections, so the two numbers are not meant to match.
- While the app is down the router keeps counting, so the traffic is not lost. It arrives in one large delta on the next successful push and is attributed to the day that push landed.
