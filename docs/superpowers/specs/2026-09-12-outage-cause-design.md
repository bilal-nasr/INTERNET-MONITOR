# Outage cause: your side or the ISP's

## Problem

The router is the only reporter and it reports over the connection that fails.
While an outage lasts the app sees silence, and "router has no power" looks the
same as "PPPoE is up but carries no traffic". The dashboard can only say
**No contact**.

The cause can be established afterwards. When the router reconnects, it can
send evidence gathered during the silence, and the app labels the outage.

## Physical setup this design assumes

- A **power bank** has PoE ports. One powers the **ISP switch on the roof**. The
  other feeds the **MikroTik ether1** (`ISP-ether1`) with a LAN cable that also
  carries power.
- The roof switch and the router depend on the power bank independently, and
  the owner sometimes unplugs the MikroTik cable. The design therefore never
  infers one device's state from the other's.
- Whether the power bank passes the roof link straight through (passive
  injector) or switches it is unknown. See [Open point](#open-point-does-ether1-see-the-roof-switch).

## Router facts verified on the hardware (hEX lite, RouterOS 7.24.2, 2026-09-12)

- Netwatch `internet-probe` (1.1.1.1, every 1 m, 3 packets, `thr-loss-percent=100`)
  is installed, `status=up`, and its down-script runs `pppoe-reconnect`.
- `:tonum [/system resource get uptime]` gives whole seconds (`108448`).
- `/interface get ... running` gives a bool, `link-downs` gives a num, and
  `/tool netwatch get ... status` gives `up`/`down`.
- The NTP client is off, and `/ip cloud update-time=yes` sets the clock. After a
  power cut the clock is wrong until the router is back online. **Uptime is the
  only clock-independent time source**, so all evidence is recorded in uptime
  seconds.
- Logging goes to memory only (1000 lines), and quota-push fills it in about an
  hour. The router log is not usable as outage history.

## Causes

| Cause key | Evidence | Side |
| --- | --- | --- |
| `router_off` | Uptime in the first push after the silence is shorter than the silence. The span runs from the last push to boot, where boot = push time − uptime. Covers "power bank empty" and "MikroTik unplugged", which the router cannot tell apart. Makes no claim about the ISP during that span. | yours |
| `roof_link_down` | Router stayed up, and ether1 was seen not running, or its `link-downs` rose. | yours |
| `pppoe_down` | ether1 up, PPPoE down, netwatch not down, and no planned reconnect explains it. | ISP |
| `no_internet` | Netwatch down, whether PPPoE was up or being cycled by the watchdog. | ISP |
| `scheduled_reconnect` | PPPoE drop matched by a rise in the `pppoe-reconnect` planned counter while netwatch was up. | neutral |
| `app_unreachable` | Router, ether1, PPPoE and netwatch all fine; only the POST failed. | not an outage |
| `unknown` | Evidence missing or implausible (old script, uptime going backwards without a gap, times outside the silence). | unknown |

Rules:

- **Precedence**, applied over each instant of the silence: `router_off` >
  `roof_link_down` > `no_internet` > `scheduled_reconnect` > `pppoe_down` >
  `app_unreachable`. A PPPoE drop is only `pppoe_down` when no planned reconnect
  explains it. Netwatch-down beats PPPoE-down because the watchdog cycles
  PPPoE whenever netwatch is down.
- **Mixed silences** are split into ordered segments. After a reboot the rules
  above apply from boot onwards. For example, PPPoE only coming up 20 minutes
  after boot is its own segment and is not blamed on power.
- **A silence** is a push arriving more than 90 s (three intervals) after the
  previous one.
- **Startup grace:** after a reboot, the first 180 s count as `router_off`
  whatever the links did. The router booting, the roof switch booting and PPPoE
  dialing are all part of coming back from a power cut.
- **Edge snapping:** a down mark within 95 s of the start of the evidence window
  counts from that start. Netwatch needs up to about 63 s to declare down, and
  quota-push samples every 30 s, while pushes fail at once. An up mark within
  35 s of the push that ended the silence counts to that push.
- **What happened before a reboot is unknowable.** The globals died with the
  power, so the whole span from the last push to boot is `router_off`, even when
  the ISP failed first.

## Router side

### `router/quota-push.rsc` (and `lib/router/script-template.ts`, which a test keeps identical)

Every run, before the POST, the script reads uptime, ether1 `running`, PPPoE
`running` and netwatch `status`, and keeps these globals (uptime seconds, cleared
after a successful push, lost on reboot, which uptime reveals anyway):

- `qpEthDownAt` / `qpEthUpAt`: uptime of the first run that found ether1 down,
  and of the first run that found it up again after that
- `qpPppDownAt` / `qpPppUpAt`: the same for PPPoE
- `qpNetDownAt` / `qpNetUpAt`: the same for netwatch

A first-down value is never overwritten until a push succeeds, so flaps inside
one silence produce the span from the first down to the last up.

New JSON fields (all optional on the server):

`uptime_s`, `ether_running`, `ether_link_downs`, `pppoe_link_downs`, `netwatch`
(`up`/`down`/`unknown`), `planned_reconnects`, `push_failures` (the existing
`qpFail`), `eth_down_at`, `eth_up_at`, `ppp_down_at`, `ppp_up_at`,
`net_down_at`, `net_up_at` (uptime seconds, or empty).

A missing netwatch entry sends `netwatch: "unknown"` and never fails the script.

### `router/pppoe-reconnect.rsc`

Increments a global `qpPlanned` counter on every run. When netwatch runs it,
netwatch-down wins by precedence, so a shared counter is harmless.

### Documentation

`router/internet-watchdog.md` and the README gain a short section explaining what
the labels mean.

## App side

### Schema (`schema.sql`, `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` like the rest)

- `router_status`: a single row holding the last push's snapshot: `recorded_at`
  plus the fields above as columns or one `JSONB` column. It is upserted on every
  push that carries the new fields.
- `outage_causes`:
  - `id`
  - `silence_from TIMESTAMPTZ`: the previous push
  - `silence_to TIMESTAMPTZ`: this push
  - `segments JSONB`: `[{from, to, cause}]`, ordered and non-overlapping, covering
    the silence
  - `evidence_before JSONB`, `evidence_after JSONB`: raw snapshots, so the rules
    can be re-run if they change
  - `created_at`
  - Unique on `silence_from`, so two pushes ending the same silence write it once.
  - Not thinned by retention.

### `lib/outage-cause.ts` (pure)

`classifySilence(before, after, silenceFrom, silenceTo): Segment[]`

- Converts uptime offsets to server time as `silenceTo − (after.uptime_s − x)`.
- Clamps every derived instant into `[silenceFrom, silenceTo]`. An instant that
  cannot be placed makes its segment `unknown`.
- Does no I/O, so every rule is unit-testable.
- Has no zod import either, because client components import it. The push
  body's zod fields live in `lib/outage-evidence.ts`.

### `app/api/ingest/route.ts`

- The body schema accepts the new optional fields.
- After the reading, session and quota steps: read `router_status`. If the gap to
  its `recorded_at` exceeds 90 s, classify and insert into `outage_causes`. Then
  upsert `router_status`.
- Wrapped so that any failure is logged and never fails the push, the same
  pattern as the cycle alert check.

### Reading causes: `lib/outages.ts`

- Outage spans stay as they are, derived from sessions, so **downtime totals do
  not change**.
- A new helper attaches the cause segments that overlap each outage.
- Outage time not covered by any segment is `unknown`, which covers history from
  before this feature.
- Silences whose segments are all `app_unreachable`, or that overlap no session
  outage (short no-internet blips where PPPoE never dropped), are returned
  separately as **monitoring gaps**. They are not counted as downtime.

## UI

- **Sessions table, "Offline before":** a cause label after the duration. A mixed
  outage shows the parts in order (`Router off 40m → No internet 5m`).
  - amber: your side
  - red: ISP
  - grey: scheduled
  - dashed grey: unknown
- **`OutageSummary`:** the total-downtime tile's hint gains a split: *Your side ·
  ISP · Unknown*.
- **`OutageCalendar`:** each day's tooltip shows the same split.
- **Monitoring gaps:** a small list under the calendar on `/sessions` (cause,
  duration, start).
- **"Router is back" mail** (`lib/cron/stale.ts`, `lib/email-link-template.ts`):
  names the cause when an `outage_causes` row covers the silence. By the time the
  tick runs, the push that ended the silence has already written it. Otherwise
  the mail is unchanged.
- **`StatusCard` "No contact":** one added line: the cause will show once the
  router reconnects.
- Strings in `lib/i18n/dictionaries/en.ts` and `ar.ts`.

## Error handling

- Classification never fails a push.
- Missing or implausible evidence gives `unknown`, never a guess.
- An old router script (no new fields) behaves exactly as today. Its outages show
  as `unknown`.

## Testing

- **`lib/outage-cause.test.ts`:**
  - each cause on its own
  - router off followed by `pppoe_down` after boot
  - `no_internet` with watchdog cycling (PPPoE flaps inside netwatch-down)
  - midnight `scheduled_reconnect`
  - a flap seen only through `link-downs`
  - missing fields → `unknown`
  - uptime offsets outside the silence are clamped or `unknown`
- **Ingest body:** the repository's tests are pure (vitest, `lib/**/*.test.ts`,
  no database), so the evidence schema and `evidenceFromBody` are tested; the
  database writes are checked by hand at rollout.
- **`lib/outages` helper:**
  - segment attachment and the unknown remainder
  - monitoring gaps are kept out of downtime
- **`lib/router/script.test.ts`:** template and `.rsc` stay identical.
- **On the hardware, each step only with the owner's OK at the time:**
  1. Disable `pppoe-out1` for 60 s → expect `pppoe_down`.
  2. Owner unplugs the MikroTik for 2 min → expect `router_off`.
  3. Owner unplugs the roof cable for 60 s → settles the open point below.
  4. Confirm that `/tool fetch` with no route fails within the 30 s interval, so
     runs cannot overlap. Already verified on 2026-09-12: globals set by a
     scheduler script are visible from other contexts (an SSH session read
     `qpSid` and `qpFail`).

## Open point: does ether1 see the roof switch?

The router cannot tell whether ether1's link partner is the roof switch or the
power bank (no neighbour discovery on ether1). Hardware test 3 decides:

- **ether1 goes down:** `roof_link_down` stays as specified.
- **ether1 stays up:** a dead roof switch is indistinguishable from the ISP
  dropping PPPoE. `pppoe_down` is then relabelled **"Couldn't reach the ISP (roof
  equipment or ISP)"** with side `unknown`, and `roof_link_down` covers only an
  unplugged ether1 cable while the router stays powered, which this setup cannot
  produce.

## Out of scope

- Telling "power bank empty" from "MikroTik unplugged".
- Live cause while the silence lasts.
- Labelling no-internet periods during which pushes still get through (for
  example 1.1.1.1 unreachable but Vercel reachable).
- Rebuilding causes for outages from before this feature.
