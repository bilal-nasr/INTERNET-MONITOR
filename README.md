# mikrotik-quota-monitor

Tracks home internet usage from a MikroTik router, stores the history in Postgres, and emails you when usage inside a daily time window exceeds a quota. It also records every WAN link session, so you can see how long each connection lasted and how much it carried.

The router pushes its counters to the app. The app never connects to the router, which is what makes this work behind carrier-grade NAT where the router has no reachable public address.

Stack: Next.js 16 (App Router, TypeScript), Postgres via `pg-promise`, Resend for email, Recharts, Tailwind. Package manager is pnpm. Ships as a Docker image.

## Signing in

Every page and every API route except the router's push, the health probe and the sign-in endpoints requires a signed-in user. `schema.sql` seeds one account:

| Username | Password |
| --- | --- |
| `bilalnasr` | `admin123` |

**Change that password on `/settings` before the app is reachable by anyone but you.** The Account section there also takes an email address, which is where a "forgot password" link is sent; while it is empty the link goes to the alert email instead.

How a session works:

- Signing in creates a row in `auth_sessions` and sets two HttpOnly cookies: `qm_access` (15 minutes) and `qm_refresh` (30 days, sliding). Only SHA-256 hashes of the tokens are stored.
- Every request presents the access cookie. When it has lapsed, `proxy.ts` mints a new access token from the refresh cookie on the spot, so a returning browser is never sent to the login page while its refresh token is alive. `POST /api/auth/refresh` does the same explicitly.
- Signing out revokes the row, which kills both tokens at once. Changing the password signs every other browser out; a password reset signs all of them out.
- Wrong passwords are throttled to five per fifteen minutes per address and username, in memory.
- The `Secure` cookie flag follows the request: HTTPS gets it, a plain-HTTP LAN address does not, so login works on both. Behind a reverse proxy, forward `X-Forwarded-Proto` and `X-Forwarded-Host` so cookies and reset links are built for the public address (or set `APP_URL`).

The one other secret is `CRON_SECRET`, the bearer token the router sends to `/api/ingest`. It is the only thing stopping anyone from injecting fake readings.

## How it works

Every 30 seconds the router runs a small script (`router/quota-push.rsc`) that reads the WAN interface counters and POSTs them to `/api/ingest` with `Authorization: Bearer $CRON_SECRET`. For each reading the app:

1. Reads the single row of the `settings` table. If `polling_enabled` is false the reading is discarded.
2. Stores the counters in `interface_readings`.
3. Updates the current session in `sessions`, or starts a new one if the link reconnected.
4. If the local time (in `settings.timezone`) is inside `window_start`-`window_end`:
   - creates today's `daily_windows` row on the first reading, with the last reading at or before
     the window opened as the baseline, or the current one when there is no earlier reading;
   - computes usage since the baseline by summing the deltas between consecutive readings;
   - if usage has reached a daily mark not yet mailed today, claims that mark in
     `daily_windows.notified_level` and emails `alert_email_to` (see [Alerts](#alerts)).
5. Outside the window none of step 4 runs: the reading is stored and nothing else about the daily
   quota is computed or mailed.
6. Checks the monthly cap, inside the window or out of it, at most once every five minutes, and
   mails its marks and the projection warning.

Quota is decimal gigabytes: 8 GB = 8,000,000,000 bytes.

Alongside the daily window quota there is a monthly cap (`settings.monthly_quota_gb`, 600 GB by
default) measured over a billing cycle that rolls over on `settings.billing_cycle_day`, the 5th by
default. Unlike the daily quota the cap counts all traffic at every hour, not just traffic inside
the window. It is reported on the dashboard and on `/stats`, and it has its own alert marks (see
[Alerts](#alerts)).

### Alerts

Alerts are mails, sent through Resend to `settings.alert_email_to`, in the language chosen on
`/settings`. Every decision to send one, whether it went out, failed or was skipped for want of an
address, is a row in the `alerts` table and appears on `/alerts`.

- **Daily marks** (`alert_thresholds`, default `50, 80, 100`): percent of the daily quota, measured
  inside the window. A mail goes out the first time usage reaches each mark; a jump past several
  marks in one reading sends one mail for the highest. 100 is the "exceeded" alert. The day's
  highest mailed mark is kept in `daily_windows.notified_level`; an empty list turns daily mails
  off.
- **Monthly marks** (`cycle_alert_thresholds`, default `80, 100`): the same rule against the
  monthly cap over the whole cycle, checked at most every five minutes. State is in
  `cycle_alerts`, keyed by the cycle's start date.
- **Projection warning** (`cycle_pace_alert`, on by default): one mail per cycle, the first time
  the projected end-of-cycle usage exceeds the cap, from the fourth day of the cycle onwards.

A mark is claimed in the database before the mail is sent, so two readings arriving together
cannot both send it, and a failed send releases the claim so a later reading retries it. That
retry waits fifteen minutes after a failure, since a send that fails usually fails for a reason
that will not have changed thirty seconds later - an unset `RESEND_API_KEY`, a from-address on an
unverified domain. Alerting never fails a push: the reading is already stored, and whatever goes
wrong afterwards is reported on `/alerts` instead. The projection warning is held back when a cap
mail just went out in the same check, because that mail already carries the projection.

### Session accounting

A PPPoE interface restarts its counters at zero on every reconnect, so totalling the raw counter would lose traffic on each drop. Instead each session row keeps both the last raw counter and a running total, and adds `counter - last_counter` per sample, or the whole counter when it went backwards.

A new session starts when the router reports a different session id, or when the counters go backwards, which catches a reconnect the router never got to report.

Timestamps come from the server clock, except the moment the link came up, which only the router knows. Since `link_up` and `router_time` are read from the same clock, the difference between `router_time` and the server clock is subtracted from `link_up`, so the timeline stays correct even if the router's clock is wrong. Start times are clamped so sessions can never overlap or show a negative offline gap. When the router reports no link-up time at all, the start is inferred from the earliest reading of the current counter run.

The known limit: traffic between the last sample and an unexpected drop cannot be recovered, so a session can under-report by up to one polling interval.

### Retention

Readings arrive every 30 seconds, about 2,900 rows a day and over a million a
year. Once a day the scheduler (see "Scheduled jobs") thins readings older than
`Keep full detail for (days)` on `/settings` (90 by default) down to the last
reading of each hour. Traffic figures are the growth of the counter between one
reading and the next, so the totals, the daily history, the billing cycle and the
statistics page stay right along the chain: every surviving pair's delta still
covers the readings deleted between them. The one exception is the oldest hour
still stored, whose leading readings have no earlier survivor left to measure
from, so their growth is dropped (119,000 bytes out of 8,639,000 when the
statements were checked against a real Postgres). What is lost for those old dates:
minute-level charts, per-reading peak rates, and up to an hour of traffic around a
counter reset that fell inside a thinned hour. Each run handles at most 30 days,
so a large backlog is worked off over several days.

### Import

`/export` also takes a file back. Choose a CSV or JSON written by the export and
press Import: every reading is loaded unless the database already holds one at the
same instant on the same interface, and a row the parser cannot read is listed
rather than stopping the import. Files from before the `interface_name` column are
accepted and labelled with the interface from `/settings`. Sessions and daily quota
windows are not in the file: they are derived from readings as they arrive, and a
session cannot be rebuilt from counters alone, so after restoring a database the
Sessions page starts from the next link event.

### Metrics and Home Assistant

`GET /api/metrics` serves the dashboard's headline figures as Prometheus gauges
(`quota_monitor_today_used_bytes`, `quota_monitor_cycle_percent`,
`quota_monitor_link_up`, ...). A scraper authenticates with `METRICS_TOKEN`:

```yaml
scrape_configs:
  - job_name: quota-monitor
    # Prometheus scrapes every 15 seconds by default, and every scrape takes a
    # connection from the same ten-connection pool the router's pushes use.
    scrape_interval: 60s
    scheme: https
    authorization:
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ["netmonitor.bilalnasr.com"]
    metrics_path: /api/metrics
```

Home Assistant reads the JSON feed behind the read-only share link (see "Sharing";
this needs the share link feature) with a REST sensor:

```yaml
rest:
  - resource: https://netmonitor.bilalnasr.com/api/share/<token>/usage
    scan_interval: 60
    sensor:
      - name: "Internet used today"
        unit_of_measurement: "GB"
        value_template: "{{ (value_json.today.used_since_baseline / 1e9) | round(2) }}"
      - name: "Internet cycle used"
        unit_of_measurement: "%"
        value_template: "{{ value_json.cycle.percent_of_cap | round(1) }}"
```

## Setup

### 1. Database

Any Postgres works. Run `schema.sql` once; it is idempotent and seeds the settings row and the first account (see [Signing in](#signing-in)).

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

Open `/settings` and set the timezone, daily quota and window, the monthly cap and its cycle day,
the alert email and the WAN interface name.

Until the first reading arrives the dashboard shows a setup checklist instead of charts: whether
`CRON_SECRET` and `RESEND_API_KEY` are set, whether an alert address is saved, and a link to the
generated router script. It turns into the dashboard on its own on the first push.

The unit tests cover the pure logic: range resolution, billing-cycle arithmetic, chart series
shaping and the quota window bounds. They need no database.

```bash
pnpm test          # once
pnpm test:watch    # while editing
```

### 3. Email (Resend)

Create an API key at <https://resend.com>. For real delivery, verify a domain and set `ALERT_EMAIL_FROM` to an address on it. Without a verified domain, `onboarding@resend.dev` works but only delivers to the address that owns the Resend account. The "Send test email" button on `/settings` confirms the setup.

Set `APP_URL` to this dashboard's public address to give alert emails an "Open the dashboard" button. It is optional; without it the button is left out.

The alert reports the day's overage, the download and upload split, the billing cycle with its projection, the last seven days against the quota, and connection health. `GET /api/test-email` renders the same mail in the browser without sending it, which is the way to preview changes to it; add `?sample=1` to render fixture data when the database is empty.

### 4. The router script

In WinBox:

1. **System > Scripts**, click **+**. Name it `quota-push`, paste everything below the dashed line in [`router/quota-push.rsc`](router/quota-push.rsc) into **Source**, keep the default policies, click OK.
2. Easiest: open `/settings` in the app. The **Router script** card shows this script with the interface name, the app's URL and the secret already filled in; click **Copy script** and paste it into **Source**. Otherwise edit the four values at the top by hand:
   - `iface` - your WAN interface name. Check **Interfaces**; with PPPoE it is usually `pppoe-out1`, not the physical port, because that is where the session counters live.
   - `url` - `http://<app-host>:3000/api/ingest`
   - `secret` - the same string as `CRON_SECRET`
   - `throttleQueue` - leave as `quota-throttle` unless you renamed the queue (see below)
3. **System > Scheduler**, click **+**: name `quota-push`, start time `startup`, interval `00:00:30`, on event `/system script run quota-push`.
4. Select the script and click **Run Script**. **Log** should show `quota-push: sent tx=... rx=...` and a reading should appear on the dashboard within seconds.

Set the same interface name on `/settings` so the dashboard labels it correctly.

The script reports `session_start`, `session_end` and `session_restart` alongside each sample, which is what fills the `/sessions` page. A failed POST is retried on the next run rather than lost.

### Install on a phone

The dashboard is installable: open it in Chrome on Android or Safari on iOS and choose
"Add to Home Screen". It opens full screen in the language you last used. It needs HTTPS,
which a Vercel deployment or any reverse proxy with a certificate provides.

### Starting a fresh session on purpose

A session ends and a new one begins whenever the WAN link drops, with no configuration needed. Two optional scripts add the other cases:

- [`router/pppoe-reconnect.rsc`](router/pppoe-reconnect.rsc) cycles the PPPoE client. Run it from a scheduler at `00:00:00` with `interval=1d` for one fresh session per day.
- [`router/internet-watchdog.md`](router/internet-watchdog.md) covers the case the link state misses: PPPoE still "running" while the ISP has an outage behind it. It uses RouterOS netwatch to probe a public address once a minute and call `pppoe-reconnect` when three consecutive pings are lost. Do not try this with `/ping` inside a scheduled script: on RouterOS 7.24 `/ping` returns nothing usable from a script, so such a check never fires.

Both install the same way as `quota-push`: paste into **System > Scripts**, then add a scheduler that runs the script. Add `pppoe-reconnect` first, since the watchdog calls it.

Cycling the PPPoE client does not reset the interface counters on every RouterOS build, so the app decides where a new session starts by comparing counters with the previous session rather than assuming zero. Either behaviour produces the right per-session total.

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

### Throttling the house when a limit is exceeded

The app never connects to the router, but the router asks the app something every 30 seconds, so enforcement rides on the answer. Every reply from `/api/ingest` carries:

```json
"policy": { "throttle": false, "reason": null }
```

`throttle` becomes `true` while the daily quota is exceeded inside its window (when **Throttle when the daily quota is exceeded** is on in `/settings`) or while the monthly cap is exceeded (**Throttle when the monthly cap is exceeded**). `reason` names which. The `quota-push` script reads the reply and, when the answer changes, enables or disables a simple queue named `quota-throttle` over the LAN.

Setup, once:

1. Run [`router/throttle-setup.rsc`](router/throttle-setup.rsc) in **New Terminal**. It creates the queue disabled, at 2M/2M; edit `maxLimit` to taste. **Check `lanTarget` at the top of that script first.** It defaults to RouterOS's own `192.168.88.0/24`; on a renumbered LAN a queue aimed at the wrong subnet matches nothing and throttles nothing, with no error to tell you. `IP > Addresses` (or `/ip address print`) shows the address on the bridge - `192.168.1.1/24` there means `lanTarget "192.168.1.0/24"`.
2. Make sure the installed `quota-push` script is the current version (the one on `/settings`), since older versions ignore the reply.
3. Switch the enforcement toggles on in `/settings`.

Two things to know:

- The default RouterOS configuration fasttracks established connections, and fasttracked packets never reach a queue. The script therefore disables the rule with comment `defconf: fasttrack` while the queue is on, and re-enables it after. On a hEX lite this means every packet goes through the full firewall while throttled, which costs CPU, but only for as long as the throttle lasts.
- **The throttle is not instant for transfers already running.** Disabling the fasttrack rule only stops *new* connections being fasttracked. A connection that was already fasttracked keeps bypassing the queue until its connection-tracking entry is gone, and for an established TCP download that is `tcp-established-timeout` - one day by default (`/ip firewall connection tracking`). So new connections are limited within 30 seconds, but the big download that blew the quota can keep running at full speed. To cut what is in flight, run `/ip firewall connection remove [find]` from the router terminal; that drops *every* tracked connection, not only the fasttracked ones, so VoIP calls and SSH sessions have to re-establish. The script does not do this by itself for that reason.
- The decision is made on the server and only re-evaluated on the next push. When the window closes or the cycle rolls over, the throttle lifts on the first push afterwards, at most 30 seconds later. The monthly figure is cached for five minutes on the server, so the cap throttle can start up to five minutes after the cap is crossed.
- **The throttle fails open.** The policy is applied outside the fetch, so a push that fails - app down, database down, rotated `CRON_SECRET` answering 401, changed URL - cannot leave the house throttled forever. Six consecutive failures (three minutes at a 30 second interval) lift the throttle: the queue is disabled and the fasttrack rule re-enabled, and the log shows `quota-push: throttle OFF`. The app can only hold the throttle on while it is reachable. Change `failLimit` at the top of the script to trade recovery speed against tolerance for blips.

If the queue does not exist the script does nothing about the policy and logs nothing, so the setting is harmless until the router is ready.
### Per-device usage

Off by default. When enabled on `/settings` (Router section), a second router script
reports every LAN device's counters once a minute and `/devices` shows who used what,
with a stacked chart of the top eight and a rename box for each device.

Preconditions, all verified on a hEX lite running RouterOS 7.24.2:

- The counters come from `/ip kid-control device`, which RouterOS only fills once at
  least one kid-control **user** exists. `router/devices-setup.rsc` adds one placeholder
  user named `all-devices`. No per-device configuration is needed: with a single user
  present RouterOS tracks every LAN device by itself, as `dynamic` entries carrying
  per-MAC `bytes-up`/`bytes-down`. Remove the user and every dynamic entry disappears
  within about 45 seconds.
- **Fasttrack is left enabled, and must be.** The widely repeated claim that fasttracked
  traffic escapes kid-control accounting is wrong on this build: measured on the router,
  with `defconf: fasttrack` enabled and untouched, a ~20 MB download raised that device's
  `bytes-down` by 22,596,238 bytes. Disabling fasttrack would cost the hEX lite real CPU
  and buy nothing. If you ran an earlier version of the setup script that disabled it,
  put it back with `/ip firewall filter enable [find comment="defconf: fasttrack"]`.
  (This is unrelated to throttling, where fasttrack genuinely does bypass simple queues
  and `quota-push` genuinely does have to toggle the rule.)
- **A kid-control user defaults to a working-hours schedule, and blocks its devices
  outside it** - `mon 7h-21h`, `sat 6h-22h` and so on, as created on this router. A
  placeholder added the naive way would knock the LAN offline every night. The setup
  script therefore creates the user with every day allowed around the clock and then
  logs the seven schedule lines it actually set. Read them in **Log** after running it;
  if any shows a working-hours range, fix it under **IP > Kid Control** before walking
  away.
- A downstream router in NAT mode (an Archer AX55 Pro on this network) hides its clients
  behind one MAC. Only devices the MikroTik hands addresses to appear separately. In
  access-point mode every client shows up on its own.

Setup:

1. Run `router/devices-setup.rsc` once, then read the `devices-setup: schedule …` lines it
   writes to **Log** and confirm all seven cover the whole day.
2. Add `router/devices-push.rsc` as a script with policies `read, test`, fill in `url`
   (`.../api/ingest/devices`) and `secret` (the same `CRON_SECRET`), and schedule it every
   minute. The log line `devices-push: sent N devices` confirms it.
3. Turn on per-device tracking on `/settings`. The Devices link appears in the header.

Names come from the DHCP lease's host-name; rename any device on the page. Usage is the
growth of each device's counter between pushes, so a router reboot loses at most one
minute. Pushes are batched at 200 devices.
## Bot check (Cloudflare Turnstile)

Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to put a Turnstile widget on sign in, forgot
password, reset password and the share link. The server verifies every token with Cloudflare, so
`POST /api/auth/login`, `/forgot` and `/reset` then need a `turnstile_token` in the body and answer
`403` `captcha_failed` without a valid one. Leave either key unset to turn the check off. Both are
read at runtime. In the Cloudflare dashboard, list every hostname the dashboard is opened on,
including `localhost` if you use Turnstile in development.

## Sharing

The Sharing section on `/settings` creates a read-only link, `/<lang>/share/<token>`, that shows
the dashboard's three cards (today's window, the router, the billing cycle) to anyone holding it,
with no sign-in. It never shows settings, history or the sessions page. Replacing the link stops
the old one working; turning sharing off does the same. The token is a secret: treat the link
like a password and replace it if it leaks.

With Turnstile configured (below), a browser opening the link passes a Cloudflare bot check first
and is then let in for 12 hours. The JSON feed is not gated.

The same token serves `GET /api/share/<token>/usage`, which returns today's usage and the cycle
figures as JSON. A Home Assistant REST sensor can read it:

```yaml
rest:
  - resource: https://netmonitor.example.com/api/share/<token>/usage
    scan_interval: 60
    sensor:
      - name: "Internet used today"
        unit_of_measurement: "GB"
        value_template: "{{ (value_json.today.used_since_baseline / 1e9) | round(2) }}"
      - name: "Internet cycle used"
        unit_of_measurement: "%"
        value_template: "{{ value_json.cycle.percent_of_cap | round(1) }}"
```

Signed-in browsers are listed further down the same page; any of them can be signed out from
there, and "Sign out everywhere else" drops all but the current one.

## Languages

The interface is written in English and Arabic. The language is the first segment of every path,
so `/en/stats` and `/ar/stats` are the same page in two languages and either can be bookmarked or
shared. A request without one is redirected: a language chosen from the switcher is remembered in a
`NEXT_LOCALE` cookie and wins, otherwise the browser's `Accept-Language` decides, and failing that
English.

Arabic sets `dir="rtl"` and the layout mirrors with it. Two things deliberately do not mirror.
Chart axes that carry an order stay left to right, because reversing a time axis states something
different about the data rather than translating it; every label, tick and tooltip on them is still
translated. And figures keep Latin digits and their units in both languages, so a number read on
screen is the same number found in an export or in the database.

Every string lives in `lib/i18n/dictionaries/`. English is the source of truth for the shape, and
Arabic is checked against it at build time, so a key added to one and forgotten in the other fails
to compile rather than rendering as nothing.

Counted phrases carry CLDR plural categories, so a period reads grammatically: "آخر يومين" for two
days rather than "آخر 2 أيام". Figures the pages report take the opposite approach and name what is
counted before the number, as in "عدد الجلسات: 6". The label then stays put while the figure ticks,
instead of the sentence around it rewriting itself between one refresh and the next.

Alert emails are the exception to all of the above: they are composed with no request behind them,
so they follow the `language` column in `settings` rather than a URL. Set it on the settings page.

## API

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/ingest` | Requires `Authorization: Bearer $CRON_SECRET`. Body `{ "tx_bytes", "rx_bytes", "iface"?, "running"?, "session_id"?, "link_up"?, "router_time"? }` as JSON or form-encoded. The response carries `policy` (see [Throttling](#throttling-the-house-when-a-limit-is-exceeded)). |
| `GET` | `/api/health` | `200` when the database is reachable, `503` otherwise. Used by the container health check. |
| `GET` | `/api/usage/today` | Today's readings, baseline, `used_since_baseline`, quota and window state. |
| `GET` | `/api/usage/history?days=30` | Per-day min, max, reboot-aware usage and reading count. Max 365 days. |
| `GET` | `/api/sessions?range=last_30d&limit=200` | Link sessions with uptime, offline gap and traffic, plus totals. Accepts the same range parameters as `/api/stats`; `days=N` still works. |
| `GET` | `/api/sessions/totals?ids=1,2,3` | Totals for an explicit set of sessions, summed in the database. Backs the selection bar on the sessions page. |
| `GET` | `/api/stats?range=today` | Every statistic for one range: totals, a bucketed series, weekday and hour patterns, link reliability, quota compliance and billing-cycle figures. See the range table below. |
| `GET` | `/api/alerts?limit=100&before=<id>` | Every alert the app decided to send, newest first: kind, mark, recipient, subject, status and the figures it carried. `limit` is at most 500; `before` takes a row id and pages backwards. |
| `GET` | `/api/settings` | Current settings. |
| `PUT` | `/api/settings` | Any subset of fields. Validates quota > 0, `window_end` after `window_start`, email format, IANA timezone and `language` (`en` or `ar`). |
| `GET` | `/api/export?format=csv\|json&from=YYYY-MM-DD&to=YYYY-MM-DD` | Streams readings in the range, dates inclusive, in the configured timezone. |
| `POST` | `/api/test-email` | Sends a test email to `alert_email_to`. |
| `GET` `POST` | `/api/cron/tick` | Requires `Authorization: Bearer $CRON_SECRET`. Runs every scheduled job in turn and answers with what each one did. See "Scheduled jobs". |
| `POST` | `/api/auth/login` | `{ "username", "password" }`. Sets the session cookies. `401` on a wrong pair, `429` when throttled. |
| `POST` | `/api/auth/logout` | Revokes the session and clears the cookies. |
| `POST` | `/api/auth/refresh` | New access cookie from the refresh cookie; `401` and cleared cookies when it is dead. |
| `GET` `PUT` | `/api/auth/account` | The signed-in account; `PUT { "email": string \| null }` sets the reset address. |
| `POST` | `/api/auth/password` | `{ "current_password", "new_password", "confirm_password" }`. Signs other browsers out. |
| `POST` | `/api/auth/forgot` | `{ "username" }`. Emails a one-hour reset link. Always `200`, so accounts cannot be enumerated. |
| `POST` | `/api/auth/reset` | `{ "token", "password", "confirm_password" }` from the emailed link. |
| `GET` `DELETE` | `/api/auth/sessions` | The browsers signed in to the account; `DELETE` signs every other one out. |
| `DELETE` | `/api/auth/sessions/{id}` | Signs one browser out. `400` for the caller's own session, `404` when it is already gone. |
| `POST` `DELETE` | `/api/share` | Creates or replaces the read-only link (`{ "token", "url" }`), or turns sharing off. |
| `POST` | `/api/share/{token}/verify` | Public. `{ "turnstile_token" }`; sets the 12-hour share-pass cookie. `404` for a wrong token, `403` `captcha_failed` when the check fails. |
| `GET` | `/api/share/{token}/usage` | Public. Today's window usage and the billing cycle as JSON, for Home Assistant and similar. `404` for a wrong token. |

Any route that can reject a request takes an optional `lang` (`en` or `ar`), and answers in
that language; without it the `NEXT_LOCALE` cookie and then `Accept-Language` decide. The
`error` code in the body never changes, so scripts match on that rather than on the wording.
`/api/ingest` and `/api/health` are excluded: their callers are the router script and a health
probe, neither of which has a language.

Every route answers `401` `unauthorized` without a live session cookie, except these:
`/api/auth/...`, which is how a session is got in the first place; `/api/ingest`,
`/api/ingest/devices`, `/api/cron/tick` and `/api/metrics`, which carry a bearer token;
`/api/health`, which carries nothing; and `/api/share/{token}/usage` and `/verify`, whose
credential is the token in the path. `/api/share` itself, which creates and revokes that link, needs the
cookie like everything else.

### Ranges

`/api/stats` and `/api/sessions` take a `range` parameter, resolved server-side in the configured
timezone. Passing `range=custom` also requires `from` and `to`, either `YYYY-MM-DD` (whole local
days, both ends included) or `YYYY-MM-DDTHH:MM` for an exact instant.

`last_hour`, `last_6h`, `last_24h`, `today`, `yesterday`, `this_week`, `last_7d`, `this_cycle`,
`last_cycle`, `last_30d`, `last_90d`, `this_year`, `all_time`, `custom`.

The series is grouped into minute, hour, day, week or month buckets chosen from the length of the
range. Pass `bucket` to override it; a combination that would produce more than 2000 points is
rejected with `400`.

## Scheduled jobs

Two things cannot happen on the ingest path because they need to run when the
router is *not* pushing: noticing that it has gone quiet, and sending a summary
on a calendar. Both run from one endpoint, together with the daily thinning
of old readings:

```
GET or POST /api/cron/tick
Authorization: Bearer $CRON_SECRET
```

It runs every job in turn, records in `job_runs` each one that did work or failed
(skips are not recorded), and answers with what it did. Jobs are idempotent, so the endpoint can be called every minute or once a
day:

| Job | What it does | Settings |
| --- | --- | --- |
| `stale` | Emails when no reading has arrived for longer than the limit, and once more when readings resume. | Silence before alerting (minutes); 0 turns it off. |
| `digest` | Sends the quota report on a schedule: Monday 08:00 (weekly) or 08:00 on the first day of a billing cycle. | Scheduled summary. |
| `thinReadings` | Once a day, collapses readings older than the retention cutoff to one per hour (see [Retention](#retention)). | Keep full detail for (days). |

Pick a trigger:

- **Vercel**: `vercel.ts` declares a daily cron at 06:00 UTC (08:00–09:59 in
  Beirut). Vercel sends the `CRON_SECRET` environment variable as the bearer
  token itself. The Hobby plan refuses to deploy a cron that runs more than once
  a day, so a daily tick is enough for the digest and thinning but not for the
  stale alert; add the GitHub trigger below. On Pro you can raise it to
  `*/5 * * * *`.
- **GitHub Actions**: `.github/workflows/tick.yml` runs every five minutes. Set
  the repository secret `CRON_SECRET` and the repository variable `TICK_URL`
  (`https://netmonitor.bilalnasr.com/api/cron/tick`). Free, and independent of
  where the app is hosted. GitHub disables a scheduled workflow after 60 days
  with no activity in the repository, so if this is the trigger behind the
  stale alert, push something (or re-enable the workflow from the Actions tab)
  before it lapses silently.
- **Docker**: the `tick` service in `docker-compose.yml` calls the endpoint once
  a minute from inside the compose network. It sits behind its own profile, so
  it starts only with `docker compose --profile tick up`: it reads `.env.local`,
  which usually points at the real database and mail key, and nothing should
  start mailing every minute just because `docker compose up` was typed.

Locally:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

The first tick after the summary is switched on sends one immediately, which
doubles as the check that the scheduler and the mail are wired up.

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
  [lang]/layout.tsx                 document: language, direction, fonts
  [lang]/not-found.tsx              the 404, in the app's chrome and language
  [lang]/share/[token]/page.tsx     the read-only dashboard behind the share token
  [lang]/(app)/layout.tsx           navigation and the session check every data page sits behind
  [lang]/(app)/page.tsx             dashboard, auto-refreshing
  [lang]/(app)/stats/page.tsx       every statistic for a chosen range, with charts
  [lang]/(app)/sessions/page.tsx    link sessions with uptime and per-session traffic
  [lang]/(app)/alerts/page.tsx      every alert the app decided to send, and how it went
  [lang]/(app)/settings/page.tsx    settings form and the account section
  [lang]/(app)/export/page.tsx      date range export
  [lang]/(auth)/login/              sign in, forgot password, reset password
  api/auth/...                      login, logout, refresh, account, password, forgot, reset
  api/...                           route handlers listed above; not under a language
components/              UI pieces; components/auth/ holds the sign-in forms
proxy.ts                 language redirect, then the session gate with transparent refresh
lib/
  auth/                  password hashing, tokens, auth_sessions rows, cookies, resets, throttle
  alerts/                the alert log and dispatcher, the daily and monthly threshold checks
  db.ts                  pg-promise pool, type parsers and TLS selection
  certs.ts               bundled Supabase root CA
  settings.ts            settings read and upsert
  readings.ts            stores a reading and applies the quota window logic
  sessions.ts            link session tracking and reporting
  usage.ts               reading queries, reboot-aware usage math, daily history
  stats.ts               every aggregate behind /stats, all computed in Postgres
  report.ts              assembles one statistics payload from those aggregates
  range.ts               range presets resolved to absolute bounds and a bucket
  billing.ts             billing-cycle arithmetic for the monthly cap
  series.ts              gap filling, cycle folding and chart labels
  email.ts               Resend delivery
  email-report.ts        the figures an alert shows, gathered from lib/stats.ts
  email-template.ts      the alert email, rendered to subject, text and HTML
  email-cycle-template.ts  the monthly-cap email, rendered the same way
  email-link-template.ts  the router-has-gone-quiet mail
  time.ts                timezone, window and duration helpers
  i18n/                  locales, the two dictionaries, and date and number formatting
  cron/                  the scheduler: job registry, tick runner, the stale, digest and thinning jobs, and the pure schedule arithmetic
  retention.ts           when thinning is due and the cutoff it uses
router/quota-push.rsc        pushes counters to the app
router/pppoe-reconnect.rsc   cycles the WAN session (daily scheduler, watchdog)
router/internet-watchdog.md  netwatch setup for ISP outages
schema.sql               tables, migrations and the settings seed
vitest.config.mts        test runner config; specs live beside their modules
Dockerfile               production image
docker-compose.yml       local run, optionally with Postgres
```

## Notes and limits

- Timezone (`settings.timezone`, an IANA name such as `Asia/Beirut`) decides which day a reading belongs to and when the window opens. The seed value is `UTC`.
- The window cannot cross midnight: `window_end` must be after `window_start`.
- The billing cycle day may be any of 1-31. In a month that is too short it falls back to that
  month's last day, so a cycle anchored on the 31st still rolls over in February.
- Statistics are aggregated in Postgres, never in the application: a month of pushes is hundreds of
  thousands of rows and none of them are shipped to the browser.
- Selecting sessions on `/sessions` totals them in the database rather than in the browser, so the
  figure is exact and matches the definition of "total" used everywhere else.
- One mail per daily mark per day. To re-arm every mark after testing:
  `UPDATE daily_windows SET notified = false, notified_level = 0 WHERE window_date = CURRENT_DATE;`
- A failed send does not fail the push. The claim on the mark is released, the attempt is recorded
  as a `failed` row on `/alerts`, and a reading at least fifteen minutes later tries again.
- The dashboard refreshes every 15 seconds and the sessions page every 20, pausing while the browser tab is hidden. Click the "Live" pill to refresh immediately.
- Today's usage and the session totals measure different things. Today's usage is bounded by the quota window; session totals cover whole connections, so the two numbers are not meant to match.
- The quota and the sessions are independent. The quota is keyed to the local date and resets when the window next opens, so cycling the WAN session does not reset it. To align them, set the window to 00:00-23:59.
- While the app is down the router keeps counting, so the traffic is not lost. It arrives in one large delta on the next successful push and is attributed to the day that push landed.
