# mikrotik-quota-monitor

Tracks home internet usage by polling a MikroTik RouterOS REST API, stores counter history in Postgres, and emails you when usage inside a daily time window exceeds a quota. Runtime configuration (quota, window, router credentials, alert email, pause switch) lives in the database and is edited from the `/settings` page, so nothing needs a redeploy.

Stack: Next.js 16 (App Router, TypeScript), Postgres via `pg-promise`, Resend for email, Recharts, Tailwind. Package manager is pnpm. Deploys to Vercel.

## Security warning: read this first

- **No authentication.** `/`, `/settings`, `/export` and every `/api/*` route except `/api/poll` are open to anyone who reaches the deployed URL. `/settings` lets a visitor change the router credentials and alert email. `/export` lets them download your traffic history. Before sharing the URL, using a memorable custom domain, or leaving it up for long, add a gate. Options:
  - A `proxy.ts` (Next.js 16's name for middleware) that checks a cookie set by a small login page.
  - Vercel Deployment Protection with a password (Pro plan) or Vercel Authentication (team members only).
- **The router password is stored in plaintext** in the `settings.router_pass` column. It is only read server-side and never returned to the browser (`GET /api/settings` returns `has_password_set` instead), but anyone with database access can read it. Use a read-only RouterOS user (instructions below) so a leak cannot reconfigure the router. Encrypting the column at rest with a key held in an env var is a sensible future improvement.

## How it works

Every 5-15 minutes an external scheduler calls `POST /api/poll` with `Authorization: Bearer $CRON_SECRET`. The poll:

1. Reads the single row of the `settings` table. If `polling_enabled` is false it exits without touching the router or the database.
2. Fetches `GET {router_host}/rest/interface` with Basic Auth, finds the interface named `wan_interface_name`, and inserts its `tx-byte` / `rx-byte` counters into `interface_readings`.
3. Detects a router reboot (new total lower than the previous reading). Counters simply restart from the new reading; no negative delta is ever produced.
4. If the current local time (in `settings.timezone`) is inside `window_start`-`window_end`:
   - creates today's `daily_windows` row on the first reading, using the current total as the baseline;
   - computes usage since the baseline by summing the deltas between consecutive readings. Without a reboot this equals `current_total - baseline_bytes`; after a reboot it counts only the traffic accumulated on the fresh counters;
   - if usage exceeds `quota_gb * 1e9` bytes and today's row is not yet `notified`, emails `alert_email_to` and marks the row.
5. Outside the window it only records the reading.

Quota is decimal gigabytes: 8 GB = 8,000,000,000 bytes.

**Two ways to get readings in.** Pull mode is the flow above: the app calls the router. Push mode inverts it: a small script on the router posts its own counters to `POST /api/ingest` every 5 minutes, and the app runs the same storage and quota logic. Use push mode when the router has no public IP (carrier-grade NAT, see "Router behind CGNAT" below). In push mode you need no external scheduler at all and can leave the router host empty in `/settings`.

## Setup

### 1. Create the Postgres database (Neon)

1. Sign up at <https://neon.tech>, create a project, and copy the connection string (it looks like `postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`).
2. Run the schema. Either paste `schema.sql` into the Neon SQL Editor, or from a terminal:

   ```bash
   psql "postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require" -f schema.sql
   ```

   The script is idempotent and seeds the `settings` row with placeholder values. Real values are entered later on `/settings`.

Any other Postgres works the same way. For a local database without TLS use `postgres://user:pass@localhost:5432/db`.

#### Using Supabase instead

Supabase works too, with one extra step: its connection pooler presents a certificate signed by Supabase's own root CA, which Node does not trust by default. That root certificate is bundled in `lib/certs.ts` (valid until April 2031, SHA-256 fingerprint `80:70:25:AD:...:E6:CA:FA`), so set:

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres
DATABASE_SSL_CA=supabase
```

The transaction-mode pooler (port 6543) is the right choice for serverless: the app never uses prepared statements or session state, so it is compatible. The session-mode pooler (5432) and the direct connection also work. `DATABASE_SSL_CA` also accepts any other PEM certificate inline, and `DATABASE_SSL=no-verify` works as a last resort but skips server verification.

### 2. Prepare the router (RouterOS 7.x)

Enable the REST API and a hostname you can reach from the internet:

```routeros
# Cloud DDNS: gives you https://<serial>.sn.mynetname.net
/ip cloud set ddns-enabled=yes

# Let's Encrypt certificate for that hostname (RouterOS 7.6+; port 80 must be reachable)
/certificate enable-ssl-certificate dns-name=<serial>.sn.mynetname.net

# HTTPS service. The REST API is served by www-ssl at /rest.
/ip service set www-ssl disabled=no certificate=<the issued certificate name>
# Optional: restrict who may connect
/ip service set www-ssl address=0.0.0.0/0
```

If you skip the Let's Encrypt step the router uses a self-signed certificate. Set `ROUTER_TLS_INSECURE=true` in the environment to accept it (the app still verifies nothing about the certificate in that mode, so prefer a real certificate).

Create a read-only API user:

```routeros
/user group add name=api-readonly policy=read,rest-api,!local,!telnet,!ssh,!ftp,!reboot,!write,!policy,!test,!winbox,!password,!web,!sniff,!sensitive,!api,!romon
/user add name=api-readonly group=api-readonly password=<strong password> comment="quota monitor"
```

The `rest-api` policy is required for `/rest`; `read` lets it list interfaces. Confirm it works from your machine:

```bash
curl -u api-readonly:<password> https://<serial>.sn.mynetname.net/rest/interface
```

Note the exact `name` of your WAN interface in the response (default in this app: `ISP-ether1`).

Make sure the router's firewall allows the HTTPS port (443 by default) from the internet, or at least from Vercel's egress ranges. A less exposed alternative is a VPN, but then the poll must run from inside that network.

#### Router behind CGNAT: push mode

If **IP > Cloud** shows a DNS name that resolves to an address in `100.64.0.0/10` (for example `100.107.x.x`), or `curl` from outside your network cannot reach the router at all, your ISP uses carrier-grade NAT and no port forwarding or certificate will make the router reachable. Let the router push instead:

1. Deploy the app first so you know its URL, and note the `CRON_SECRET` value.
2. In WinBox open **System > Scripts**, click **+**, name it `quota-push`, paste the contents of [`router/quota-push.rsc`](router/quota-push.rsc) into **Source** (everything below the dashed line), and edit the three values at the top: your WAN interface name, `https://<your-app>.vercel.app/api/ingest`, and the secret. Keep the default policies ticked and click OK.
3. Open **System > Scheduler**, click **+**: name `quota-push`, start time `startup`, interval `00:05:00`, on event `/system script run quota-push`. Click OK.
4. Select the script and click **Run Script** once. **Log** should show `quota-push: sent tx=... rx=...` and the dashboard shows a new reading within seconds.

In push mode leave **Router host** empty in `/settings`; the dashboard then shows "Push mode" and flags when no reading has arrived for over 30 minutes. `vercel.json` and the GitHub Actions workflow are not needed. The REST API and www-ssl service can stay disabled, and no firewall rule is required, because the router only makes outbound HTTPS requests. The script needs working DNS and a correct clock on the router (**System > Clock**, or enable NTP under **System > NTP Client**).

### 3. Configure email (Resend)

1. Create an API key at <https://resend.com>.
2. For real delivery, verify a domain and set `ALERT_EMAIL_FROM` to an address on it, e.g. `Quota Monitor <alerts@yourdomain.com>`. Without a verified domain, `onboarding@resend.dev` works but can only deliver to the address that owns the Resend account.

### 4. Run locally

```bash
cp .env.local.example .env.local   # then edit DATABASE_URL, RESEND_API_KEY, CRON_SECRET, ALERT_EMAIL_FROM
pnpm install
pnpm dev
```

Open <http://localhost:3000/settings>, enter the router host/user/password, WAN interface name, timezone, quota, window and alert email, and save. Use "Send test email" to confirm Resend works. Then trigger a poll by hand:

```bash
curl -X POST http://localhost:3000/api/poll -H "Authorization: Bearer $CRON_SECRET"
```

The response JSON shows the stored reading, whether the window is active, and the quota state.

### 5. Deploy to Vercel

1. Push the repository to GitHub.
2. In Vercel, "Add New Project", import the repo. Framework is detected as Next.js.
3. Add the environment variables under Settings, Environment Variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon or Supabase connection string |
   | `DATABASE_SSL_CA` | `supabase` when using Supabase; omit for Neon |
   | `RESEND_API_KEY` | Resend key |
   | `CRON_SECRET` | a long random string, e.g. `openssl rand -hex 32` |
   | `ALERT_EMAIL_FROM` | verified sender |
   | `ROUTER_TLS_INSECURE` | `false` unless the router has a self-signed certificate |

   `ROUTER_HOST`, `ROUTER_USER`, `ROUTER_PASS`, `ALERT_EMAIL_TO`, `QUOTA_*` are not read by the app at runtime; they only document the seed defaults in `schema.sql`.

4. Deploy, then open `https://<your-app>.vercel.app/settings` and fill in the router details.

Alternatively, with the Vercel CLI (`pnpm add -g vercel`): `vercel link`, `vercel env add <NAME>` for each variable, then `vercel --prod`.

### 6. Schedule the poll

Pull mode only. In push mode the router's own scheduler drives everything and this section can be skipped.

Next.js has no built-in scheduler, so something external must call `/api/poll`.

**Option A: Vercel Cron** (`vercel.json` is included, every 15 minutes). Vercel invokes the path with a GET request carrying `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set in the project. **Limitation:** the Hobby (free) plan only allows cron jobs that run once per day, so the `*/15 * * * *` schedule will be rejected or ignored there. It works on Pro and above.

**Option B: GitHub Actions** (`.github/workflows/poll.yml`, every 10 minutes). This is the workaround for the Hobby plan. Set two repository secrets under GitHub, Settings, Secrets and variables, Actions, "New repository secret":

| Secret | Value |
| --- | --- |
| `POLL_URL` | `https://<your-app>.vercel.app/api/poll` |
| `CRON_SECRET` | the same value you set on Vercel |

Then run the workflow once from the Actions tab ("Run workflow") to confirm it returns HTTP 200. GitHub schedules are best-effort; delays of a few minutes are normal, and scheduled workflows on public repos are disabled after 60 days without commits.

If you use Option B on Hobby, delete or edit `vercel.json` so the deploy does not complain about the cron schedule.

## API

All routes return JSON except the CSV export.

| Method | Path | Notes |
| --- | --- | --- |
| `POST`/`GET` | `/api/poll` | Requires `Authorization: Bearer $CRON_SECRET`. Runs one polling cycle (pull mode). |
| `POST` | `/api/ingest` | Requires the same bearer token. Body `{ "tx_bytes", "rx_bytes", "interface"?, "running"? }` as JSON or form-encoded. Stores the reading and applies the quota logic (push mode). |
| `GET` | `/api/usage/today` | Today's readings, baseline, `used_since_baseline`, quota and window state. |
| `GET` | `/api/usage/history?days=30` | Per-day `min_bytes`, `max_bytes`, reboot-aware `used_bytes`, reading count. Max 365 days. |
| `GET` | `/api/settings` | Current settings. The password is replaced by `has_password_set`. |
| `PUT` | `/api/settings` | Any subset of fields. Validates quota > 0, `window_end` after `window_start`, email and URL formats, IANA timezone. Empty `router_pass` keeps the stored one. |
| `GET` | `/api/export?format=csv\|json&from=YYYY-MM-DD&to=YYYY-MM-DD` | Streams readings in the range (dates inclusive, in the configured timezone). |
| `POST` | `/api/test-email` | Sends a test email to `alert_email_to`. |

## Project layout

```
app/
  page.tsx               dashboard (server component, live DB + router status)
  settings/page.tsx      settings form (client, GET/PUT /api/settings)
  export/page.tsx        date range export
  api/...                route handlers listed above
components/              UI pieces (progress bar, Recharts history, forms, toast)
lib/
  db.ts                  pg-promise pool and type parsers
  settings.ts            settings read/upsert
  router.ts              RouterOS REST client (node:https, optional insecure TLS)
  usage.ts               reading queries, reboot-aware usage math, daily history
  poll.ts                the polling cycle
  email.ts               Resend alerts
  time.ts                timezone and window helpers
schema.sql               tables + settings seed
vercel.json              Vercel Cron definition
.github/workflows/poll.yml  GitHub Actions scheduler
```

## Notes and limits

- Timezone: `settings.timezone` (IANA name such as `Asia/Beirut`) decides which day a reading belongs to and when the window opens. The seed value is `UTC`; change it on `/settings` before relying on the window.
- The window cannot cross midnight (`window_end` must be after `window_start`).
- One alert per day. To re-arm after testing, `UPDATE daily_windows SET notified = false WHERE window_date = CURRENT_DATE;`.
- If the email send fails, the poll returns HTTP 502 and `notified` stays false, so the next poll retries.
- The dashboard makes a live call to the router with a 5 second timeout on every load to show interface status.
