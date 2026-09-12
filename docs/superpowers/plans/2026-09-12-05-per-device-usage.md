# Per-Device Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show which LAN device used how much traffic, per day and per range, from counters the router pushes.

**Architecture:** A second router script reads `/ip kid-control device` every minute and POSTs the per-device cumulative counters to `/api/ingest/devices`. The app stores them in `device_readings` (one row per device per push) and `devices` (one row per MAC, with a user-given label). Usage is derived exactly like WAN usage: the growth of each counter between consecutive readings, partitioned by MAC, or the whole value when the counter went backwards. A new `/devices` page lists devices for a range with inline rename and a stacked daily chart of the top eight.

**Tech Stack:** Next.js 16 App Router, TypeScript, pg-promise (`db.tx`, `pgp.helpers.insert`), zod 4, Recharts 3, vitest, RouterOS 7 scripting.

**Spec:** `docs/superpowers/plans/2026-09-12-00-roadmap.md` (shared contract 7, settings column `devices_enabled`, module `lib/devices/parse.ts`).

## Global Constraints

- Next.js 16.3.4: read `node_modules/next/dist/docs/` before writing route or page code. Dynamic route params arrive as `params: Promise<{ mac: string }>`. Dynamic pages start with `await connection()`.
- Every user-visible string is a dictionary key in `lib/i18n/dictionaries/en.ts` with an Arabic entry in `ar.ts`; `lib/i18n.test.ts` fails otherwise.
- Unit tests: vitest, `lib/**/*.test.ts`, no database.
- Schema changes are idempotent statements in the migrations section of `schema.sql`.
- Bearer-token routes use `isCronAuthorized(request)` from `lib/api.ts`; signed-in routes use `rejectUnauthenticated(request, d)`.
- Byte units are decimal (1 GB = 1e9 bytes); `formatBytes` from `lib/format.ts`.
- Do not commit. Each task ends when `pnpm test`, `pnpm lint` and `pnpm exec tsc --noEmit` all pass.
- Router changes are made by the user in WinBox or via the offered SSH; the plan supplies the exact commands. Nothing in the app connects to the router.

## Preconditions (read before starting)

Verified on the real router on 2026-09-12 (MikroTik hEX lite, RouterOS 7.24.2 stable, one 850 MHz core, 64 MB RAM):

1. **Per-device counters come from `/ip kid-control device`.** That table is empty today because it only fills once at least one entry exists under `/ip kid-control`. The setup script adds a placeholder kid named `all-devices` with no time limits and no restrictions; its only purpose is to make RouterOS start tracking every LAN device it sees. Devices then appear as dynamic rows carrying `mac-address`, `ip-address`, `bytes-up` (sent by the device), `bytes-down` (received by the device), `user` and `name`.
2. **Fasttrack bypasses kid-control accounting.** The default-configuration filter rule with comment `defconf: fasttrack` is enabled. Packets it fasttracks skip the rest of the firewall, and kid-control counts in the firewall. Task 1 verifies this on the router before anything is built. If it holds, the setup script disables that rule while device tracking is on, and the README says plainly that this raises CPU use on a hEX lite: every packet is then handled by the full firewall path. Turning `devices_enabled` on in settings is the user's decision to pay that cost; turning it off means re-enabling fasttrack on the router with the undo script.
3. **Devices behind the Archer AX55 Pro may be invisible.** The DHCP server shows two leases: the Archer at `192.168.88.253` and the monitor PC at `192.168.88.254`. If the Archer runs as a NAT router, every Wi-Fi client shares its single MAC and the Devices page will show one big "ArcherAX55Pro" row. If it runs in access-point mode, each client gets its own lease and its own row. This plan cannot verify which mode it is in; Task 1 includes the check. The feature still works either way, it simply cannot split what the router itself cannot see.

If Task 1 shows that device counters stay at zero even with fasttrack disabled, stop and report; the rest of this plan depends on those counters.

---

### Task 1: Verify kid-control accounting on the router

**Files:**
- None in the repository. This task runs read-only checks plus a reversible change on the router and records the outcome in the task report.

**Interfaces:**
- Consumes: SSH access `admin@192.168.88.1` offered by the user (password in chat, not stored).
- Produces: a yes/no answer to "does `/ip kid-control device` count bytes, and only with fasttrack disabled?" plus the Archer's mode.

- [ ] **Step 1: Confirm the baseline (read-only)**

Run over SSH (from Git Bash, with the askpass script the parent session created, or interactively):

```
/ip kid-control print
/ip kid-control device print detail
/ip firewall filter print where comment="defconf: fasttrack"
/ip dhcp-server lease print terse
```

Expected: no kids, no devices, fasttrack rule present and not disabled, two leases.

- [ ] **Step 2: Add the placeholder kid and watch devices appear**

```
/ip kid-control add name=all-devices
:delay 20s
/ip kid-control device print detail
```

Expected: one dynamic row per active LAN host, with `bytes-up` and `bytes-down` fields. Note the numbers.

- [ ] **Step 3: Generate traffic and compare with fasttrack still on**

From the monitor PC download something for a minute (any large file), then:

```
/ip kid-control device print detail where mac-address=34:5A:60:70:A4:33
```

If `bytes-down` grew by roughly the download size, kid-control counts fasttracked traffic and the setup script must NOT touch fasttrack: record "fasttrack: keep" and skip Step 4.

- [ ] **Step 4: Repeat with fasttrack disabled**

```
/ip firewall filter disable [find comment="defconf: fasttrack"]
```

Download again for a minute, then read the same row. If it now grows, record "fasttrack: must be disabled while tracking". Then restore:

```
/ip firewall filter enable [find comment="defconf: fasttrack"]
```

- [ ] **Step 5: Determine the Archer's mode**

```
/ip dhcp-server lease print terse
/ip arp print terse
```

If phones and laptops show up as separate leases or ARP entries with `192.168.88.x` addresses, the Archer is an access point and per-device rows will be meaningful. If only the Archer's MAC ever appears, record "Archer: NAT mode, Wi-Fi clients merge".

- [ ] **Step 6: Clean up and report**

```
/ip kid-control remove [find name=all-devices]
/ip firewall filter print where comment="defconf: fasttrack"
```

Expected: no kids, fasttrack rule enabled as before. Report the three findings. If device counters never grew, stop the plan here.

---

### Task 2: Schema and the `devices_enabled` setting

**Files:**
- Modify: `schema.sql` (migrations section, before the `-- indexes` heading)
- Modify: `lib/settings.ts`
- Modify: `app/api/settings/route.ts`
- Modify: `components/SettingsForm.tsx`
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts`

**Interfaces:**
- Produces: `SettingsRow.devices_enabled: boolean`, `PublicSettings.devices_enabled: boolean`, `SettingsPatch` accepting `devices_enabled`; tables `devices` and `device_readings` per roadmap contract 7.

- [ ] **Step 1: Add the tables and the column to `schema.sql`**

Insert after the `ALTER TABLE settings ADD COLUMN IF NOT EXISTS language ...` line in the migrations section:

```sql
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
```

And in the `-- indexes` section:

```sql
-- Every per-device statistic takes deltas within one MAC in (recorded_at, id)
-- order; this index serves that window directly.
CREATE INDEX IF NOT EXISTS device_readings_mac_recorded_idx
  ON device_readings (mac, recorded_at, id);
CREATE INDEX IF NOT EXISTS device_readings_recorded_at_idx
  ON device_readings (recorded_at DESC);
```

- [ ] **Step 2: Apply the schema to the development database**

Run: `psql "$DATABASE_URL" -f schema.sql` (or through Supabase's SQL editor with the same file).
Expected: no errors; `\d devices` shows the table.

- [ ] **Step 3: Plumb the setting through `lib/settings.ts`**

In `SettingsRow` add after `language: string;`:

```ts
  /** Whether device pushes are stored and the Devices page is shown. */
  devices_enabled: boolean;
```

In `PublicSettings` add after `language: string;`:

```ts
  devices_enabled: boolean;
```

In `SettingsPatch`'s `Pick<...>` union add `| "devices_enabled"`.

In the `loadSettings` SELECT, add `devices_enabled` to the column list just before `updated_at`, keeping every column already listed (other plans add theirs to the same list). On the current file the result is:

```ts
    `SELECT id, quota_gb, monthly_quota_gb, billing_cycle_day, window_start,
            window_end, timezone, alert_email_to, wan_interface_name,
            polling_enabled, language, devices_enabled, updated_at
     FROM settings WHERE id = 1`,
```

In `toPublicSettings` add `devices_enabled: row.devices_enabled,` after `language: row.language,`.

In `WRITABLE` add `"devices_enabled",` after `"language",`.

- [ ] **Step 4: Accept it in the settings route**

In `app/api/settings/route.ts`, inside `patchSchema`, add after `language: z.enum(LOCALES, e.unknownLanguage),`:

```ts
      devices_enabled: z.boolean(),
```

- [ ] **Step 5: Add the toggle to the form**

In `components/SettingsForm.tsx`:

`FormState` gains `devices_enabled: boolean;`. `toForm` gains `devices_enabled: s.devices_enabled,`. The `payload` in `onSubmit` gains `devices_enabled: form.devices_enabled,`.

Inside the Router `<Section>`, after the WAN interface `</div>`, add:

```tsx
        <label className="mt-4 flex cursor-pointer items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={form.devices_enabled}
            onClick={() => update("devices_enabled", !form.devices_enabled)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              form.devices_enabled ? "bg-series-1" : "bg-border"
            }`}
          >
            <span
              className={`absolute top-0.5 start-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                form.devices_enabled ? "translate-x-5 rtl:-translate-x-5" : ""
              }`}
            />
          </button>
          <span className="text-sm">
            {form.devices_enabled ? d.settings.devicesEnabled : d.settings.devicesDisabled}
            <span className="block text-xs text-muted">
              <Interpolate
                template={d.settings.devicesHint}
                values={{ script: <code>devices-push</code>, setup: <code>router/devices-setup.rsc</code> }}
              />
            </span>
          </span>
        </label>
```

- [ ] **Step 6: Dictionary keys**

In `en.ts` under `settings`, after `pollingHint`:

```ts
    devicesEnabled: "Per-device tracking on",
    devicesDisabled: "Per-device tracking off",
    devicesHint:
      "Stores the counters the {script} router script sends and shows the Devices page. Needs the one-time setup in {setup}, which disables fasttrack on the router and costs CPU.",
```

And in `settings.fields`: `devices_enabled: "Per-device tracking",`.

In `ar.ts` under `settings`, after `pollingHint`:

```ts
    devicesEnabled: "تتبع الأجهزة مفعّل",
    devicesDisabled: "تتبع الأجهزة متوقف",
    devicesHint:
      "يخزّن العدادات التي يرسلها سكربت {script} على الراوتر ويعرض صفحة الأجهزة. يحتاج الإعداد لمرة واحدة في {setup}، وهو يعطّل fasttrack على الراوتر ويستهلك المعالج.",
```

And in `settings.fields`: `devices_enabled: "تتبع الأجهزة",`.

- [ ] **Step 7: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass. Open `/en/settings`, flip the toggle, save, reload: it stays.

---

### Task 3: `lib/devices/parse.ts`, the push body parser

**Files:**
- Create: `lib/devices/parse.ts`
- Test: `lib/devices/parse.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DeviceSample { mac: string; ip: string | null; name: string | null; tx_bytes: number; rx_bytes: number }
export interface DevicePush { router_time: string | null; devices: DeviceSample[] }
export type ParseResult = { ok: true; data: DevicePush } | { ok: false; errors: Record<string, string[]> };
export function normaliseMac(raw: string): string | null;   // "AA:BB:CC:DD:EE:FF" or null
export function parseDevicePush(body: unknown): ParseResult;
export const MAX_DEVICES_PER_PUSH = 500;
```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/devices/parse.test.ts
import { describe, expect, test } from "vitest";
import { MAX_DEVICES_PER_PUSH, normaliseMac, parseDevicePush } from "@/lib/devices/parse";

describe("normaliseMac", () => {
  test("accepts colon, dash and bare forms and upper-cases", () => {
    expect(normaliseMac("aa:bb:cc:dd:ee:ff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normaliseMac("aa-bb-cc-dd-ee-ff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normaliseMac("aabbccddeeff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normaliseMac("  AA:BB:CC:DD:EE:FF ")).toBe("AA:BB:CC:DD:EE:FF");
  });

  test("rejects anything that is not twelve hex digits", () => {
    expect(normaliseMac("aa:bb:cc:dd:ee")).toBeNull();
    expect(normaliseMac("zz:bb:cc:dd:ee:ff")).toBeNull();
    expect(normaliseMac("")).toBeNull();
  });
});

describe("parseDevicePush", () => {
  const sample = { mac: "34:5a:60:70:a4:33", ip: "192.168.88.254", name: " bilal ", tx_bytes: 10, rx_bytes: "20" };

  test("accepts a well-formed push and normalises it", () => {
    const result = parseDevicePush({ router_time: "2026-09-12 11:48:49", devices: [sample] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.router_time).toBe("2026-09-12 11:48:49");
    expect(result.data.devices).toEqual([
      { mac: "34:5A:60:70:A4:33", ip: "192.168.88.254", name: "bilal", tx_bytes: 10, rx_bytes: 20 },
    ]);
  });

  test("blank name and missing ip become null", () => {
    const result = parseDevicePush({ devices: [{ ...sample, name: "   ", ip: undefined }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.devices[0].name).toBeNull();
    expect(result.data.devices[0].ip).toBeNull();
    expect(result.data.router_time).toBeNull();
  });

  test("trims names to 100 characters", () => {
    const result = parseDevicePush({ devices: [{ ...sample, name: "x".repeat(150) }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.devices[0].name).toHaveLength(100);
  });

  test("rejects a bad mac with the index in the error key", () => {
    const result = parseDevicePush({ devices: [sample, { ...sample, mac: "nope" }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors)).toContain("devices.1.mac");
  });

  test("rejects negative and non-integer counters", () => {
    expect(parseDevicePush({ devices: [{ ...sample, tx_bytes: -1 }] }).ok).toBe(false);
    expect(parseDevicePush({ devices: [{ ...sample, rx_bytes: 1.5 }] }).ok).toBe(false);
  });

  test("rejects more than the maximum number of devices", () => {
    const devices = Array.from({ length: MAX_DEVICES_PER_PUSH + 1 }, () => sample);
    expect(parseDevicePush({ devices }).ok).toBe(false);
  });

  test("rejects an empty list and a missing list", () => {
    expect(parseDevicePush({ devices: [] }).ok).toBe(false);
    expect(parseDevicePush({}).ok).toBe(false);
  });

  test("keeps the last sample when a mac repeats inside one push", () => {
    const result = parseDevicePush({ devices: [sample, { ...sample, tx_bytes: 99 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.devices).toHaveLength(1);
    expect(result.data.devices[0].tx_bytes).toBe(99);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run lib/devices/parse.test.ts`
Expected: FAIL, cannot find module `@/lib/devices/parse`.

- [ ] **Step 3: Implement**

```ts
// lib/devices/parse.ts
/**
 * The body the router's devices-push script sends, checked and normalised.
 *
 * Pure, so the shape rules are testable without a database. MACs are stored in
 * one canonical form because they are the primary key of `devices`: the same
 * phone must never become two rows because RouterOS printed it with dashes
 * one day and colons the next.
 */

import { z } from "zod";

export const MAX_DEVICES_PER_PUSH = 500;

export interface DeviceSample {
  mac: string;
  ip: string | null;
  name: string | null;
  tx_bytes: number;
  rx_bytes: number;
}

export interface DevicePush {
  router_time: string | null;
  devices: DeviceSample[];
}

export type ParseResult =
  | { ok: true; data: DevicePush }
  | { ok: false; errors: Record<string, string[]> };

/** "AA:BB:CC:DD:EE:FF" from any of the usual spellings, or null when it is not a MAC. */
export function normaliseMac(raw: string): string | null {
  const hex = raw.trim().replace(/[:\-.]/g, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex)) return null;
  return hex.match(/.{2}/g)!.join(":");
}

const counter = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const sampleSchema = z.object({
  mac: z
    .string()
    .transform((v, ctx) => {
      const mac = normaliseMac(v);
      if (!mac) {
        ctx.addIssue({ code: "custom", message: "not a MAC address" });
        return z.NEVER;
      }
      return mac;
    }),
  ip: optionalText(45),
  name: z
    .string()
    .optional()
    .nullable()
    .transform((v) => {
      const trimmed = (v ?? "").trim().slice(0, 100);
      return trimmed ? trimmed : null;
    }),
  tx_bytes: counter,
  rx_bytes: counter,
});

const pushSchema = z.object({
  router_time: optionalText(100),
  devices: z.array(sampleSchema).min(1).max(MAX_DEVICES_PER_PUSH),
});

export function parseDevicePush(body: unknown): ParseResult {
  const parsed = pushSchema.safeParse(body);
  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "_";
      (errors[key] ??= []).push(issue.message);
    }
    return { ok: false, errors };
  }
  // A MAC listed twice in one push is one device: the later sample wins, being
  // the newer counter value.
  const byMac = new Map<string, DeviceSample>();
  for (const device of parsed.data.devices) byMac.set(device.mac, device);
  return {
    ok: true,
    data: { router_time: parsed.data.router_time, devices: [...byMac.values()] },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run lib/devices/parse.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass.

---

### Task 4: `POST /api/ingest/devices`

**Files:**
- Create: `lib/devices/store.ts`
- Create: `app/api/ingest/devices/route.ts`
- Modify: `proxy.ts` (`PUBLIC_API`)

**Interfaces:**
- Consumes: `parseDevicePush` (Task 3), `isCronAuthorized` and `badRequest`/`errorResponse` from `lib/api.ts`, `getSettings`, `db` and `pgp` from `lib/db.ts`.
- Produces:

```ts
// lib/devices/store.ts
export function storeDevicePush(push: DevicePush, now?: Date): Promise<{ devices: number; readings: number }>;
```

- [ ] **Step 1: Write the store module**

```ts
// lib/devices/store.ts
import { db, pgp } from "@/lib/db";
import type { DevicePush } from "@/lib/devices/parse";

/** Column set for the multi-row insert; built once, pg-promise caches it. */
const READING_COLUMNS = new pgp.helpers.ColumnSet(["recorded_at", "mac", "tx_bytes", "rx_bytes"], {
  table: "device_readings",
});

/**
 * One transaction per push: every device row is upserted, then every reading
 * is inserted in a single statement. A push of two hundred devices is then two
 * round trips plus the upserts rather than four hundred inserts, which matters
 * at eighty-five milliseconds per trip to the database.
 *
 * `name` is never written here: it belongs to the owner, who sets it on the
 * Devices page. The router only ever refreshes `hostname`, `ip` and `last_seen`.
 */
export async function storeDevicePush(
  push: DevicePush,
  now = new Date(),
): Promise<{ devices: number; readings: number }> {
  return db.tx(async (t) => {
    for (const device of push.devices) {
      await t.none(
        `INSERT INTO devices (mac, hostname, ip, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (mac) DO UPDATE
           SET hostname  = COALESCE(EXCLUDED.hostname, devices.hostname),
               ip        = COALESCE(EXCLUDED.ip, devices.ip),
               last_seen = EXCLUDED.last_seen`,
        [device.mac, device.name, device.ip, now],
      );
    }
    const rows = push.devices.map((d) => ({
      recorded_at: now,
      mac: d.mac,
      tx_bytes: d.tx_bytes,
      rx_bytes: d.rx_bytes,
    }));
    await t.none(pgp.helpers.insert(rows, READING_COLUMNS));
    return { devices: push.devices.length, readings: rows.length };
  });
}
```

- [ ] **Step 2: Write the route**

```ts
// app/api/ingest/devices/route.ts
import { NextResponse } from "next/server";
import { badRequest, errorResponse, isCronAuthorized } from "@/lib/api";
import { parseDevicePush } from "@/lib/devices/parse";
import { storeDevicePush } from "@/lib/devices/store";
import { getSettings } from "@/lib/settings";

export const maxDuration = 60;

/**
 * Per-device counters, pushed by the router's devices-push script. Same bearer
 * token as /api/ingest. Discarded while per-device tracking is off in
 * settings, with a 200 so the router does not log an error every minute.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await request.text());
  } catch {
    return badRequest("body must be JSON");
  }
  const parsed = parseDevicePush(raw);
  if (!parsed.ok) return badRequest("validation failed", parsed.errors);

  try {
    const settings = await getSettings();
    if (!settings.devices_enabled) {
      return NextResponse.json({ status: "paused", message: "devices_enabled is false; push discarded" });
    }
    const stored = await storeDevicePush(parsed.data);
    return NextResponse.json({ status: "ok", ...stored });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 3: Let the route through the proxy**

In `proxy.ts`, in `PUBLIC_API`, add `"/api/ingest/devices",` directly after `"/api/ingest",`.

- [ ] **Step 4: Try it by hand**

Run (with the dev server up and `devices_enabled` on):

```bash
curl -s -X POST http://localhost:3000/api/ingest/devices \
  -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"devices":[{"mac":"34:5a:60:70:a4:33","ip":"192.168.88.254","name":"bilal","tx_bytes":1000,"rx_bytes":5000}]}'
```

Expected: `{"status":"ok","devices":1,"readings":1}`; a second call with `"nope"` as the MAC returns 400 with `devices.0.mac`. With `devices_enabled` off the response is `{"status":"paused",...}`. Without the header: 401.

- [ ] **Step 5: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass.

---

### Task 5: Router scripts

**Files:**
- Create: `router/devices-setup.rsc`
- Create: `router/devices-push.rsc`

**Interfaces:**
- Consumes: `POST /api/ingest/devices` (Task 4).
- Produces: pushes of at most 200 devices each, every 60 seconds.

- [ ] **Step 1: Write the setup script**

```
# devices-setup.rsc: one-time router preparation for per-device accounting.
#
# Paste into System > Scripts as "devices-setup", run it once, then delete it.
# What it does, and why:
#   1. Adds a kid-control entry with no limits. RouterOS only tracks per-device
#      byte counters (/ip kid-control device) once at least one kid exists; the
#      entry restricts nothing.
#   2. Disables the default fasttrack rule. Fasttracked packets skip the
#      firewall, and kid-control counts inside it, so with fasttrack on the
#      counters stay near zero. This costs CPU on a hEX lite: every packet now
#      takes the full firewall path. Re-enable it with the undo block below when
#      per-device tracking is switched off.
#
# ----------------------------------------------------------------------------
:if ([:len [/ip kid-control find name="all-devices"]] = 0) do={
    /ip kid-control add name="all-devices" comment="placeholder: makes RouterOS track per-device counters"
    :log info "devices-setup: added kid-control placeholder"
}
:local ft [/ip firewall filter find comment="defconf: fasttrack"]
:if ([:len $ft] > 0) do={
    /ip firewall filter disable $ft
    :log info "devices-setup: fasttrack disabled so kid-control sees all traffic"
}

# ---- undo (run these two lines to go back) ---------------------------------
# /ip firewall filter enable [find comment="defconf: fasttrack"]
# /ip kid-control remove [find name="all-devices"]
```

- [ ] **Step 2: Write the push script**

```
# devices-push.rsc: report every LAN device's counters to the app.
#
# WinBox setup:
#   1. Run devices-setup.rsc once (see that file).
#   2. System > Scripts > "+" : Name = devices-push, paste everything below
#      the dashed line into Source. Policies needed: read, test.
#   3. Edit url and secret below (same secret as quota-push).
#   4. System > Scheduler > "+" : Name = devices-push, Start Time = startup,
#      Interval = 00:01:00, On Event = /system script run devices-push.
#
# Terminal equivalent for the scheduler:
#   /system scheduler add name=devices-push start-time=startup interval=1m \
#       on-event="/system script run devices-push" policy=read,test
#
# The counters are cumulative since RouterOS started tracking the device; the
# app takes the difference between pushes, so a reboot that resets them costs
# at most one minute of traffic, never a double count.
#
# Devices are sent in batches of 200 so a large LAN never builds one huge
# string on a router with 64 MB of RAM.
# ----------------------------------------------------------------------------
:local url    "http://APP-HOST:3000/api/ingest/devices"
:local secret "PASTE-YOUR-CRON_SECRET-HERE"
:local batchSize 200

:local stamp ([/system clock get date] . " " . [/system clock get time])

# Drops the two characters that would break a JSON string. RouterOS has no
# replace, so this walks the string once.
:local clean do={
    :local out ""
    :for i from=0 to=([:len $1] - 1) do={
        :local c [:pick $1 $i ($i + 1)]
        :if (($c != "\"") && ($c != "\\")) do={ :set out ($out . $c) }
    }
    :return $out
}

:local items ""
:local count 0
:local sent 0

:local flush do={
    # $1 = items, $2 = count. Posts one batch and logs it.
    :local body ("{\"router_time\":\"" . $stamp . "\",\"devices\":[" . $1 . "]}")
    :do {
        /tool fetch url=$url http-method=post http-data=$body \
            http-header-field="Content-Type: application/json,Authorization: Bearer $secret" \
            output=none
        :log info ("devices-push: sent " . $2 . " devices")
    } on-error={
        :log warning "devices-push: POST to $url failed"
    }
}

:foreach id in=[/ip kid-control device find] do={
    :local mac [/ip kid-control device get $id mac-address]
    :if ([:len $mac] > 0) do={
        :local ip ""
        :do { :set ip [:tostr [/ip kid-control device get $id ip-address]] } on-error={ :set ip "" }
        :local up 0
        :local down 0
        :do { :set up [/ip kid-control device get $id bytes-up] } on-error={ :set up 0 }
        :do { :set down [/ip kid-control device get $id bytes-down] } on-error={ :set down 0 }

        # Prefer the DHCP hostname; fall back to the kid-control name, if any.
        :local name ""
        :do {
            :local lease [/ip dhcp-server lease find mac-address=$mac]
            :if ([:len $lease] > 0) do={ :set name [/ip dhcp-server lease get ($lease->0) host-name] }
        } on-error={ :set name "" }
        :if ([:len $name] = 0) do={
            :do { :set name [/ip kid-control device get $id name] } on-error={ :set name "" }
        }
        :set name [$clean $name]

        :local item ("{\"mac\":\"" . $mac . "\",\"ip\":\"" . $ip . "\",\"name\":\"" . $name . \
            "\",\"tx_bytes\":" . $up . ",\"rx_bytes\":" . $down . "}")
        :if ($count > 0) do={ :set items ($items . ",") }
        :set items ($items . $item)
        :set count ($count + 1)

        :if ($count >= $batchSize) do={
            $flush $items $count
            :set sent ($sent + $count)
            :set items ""
            :set count 0
        }
    }
}

:if ($count > 0) do={
    $flush $items $count
    :set sent ($sent + $count)
}
:if ($sent = 0) do={ :log info "devices-push: no devices tracked yet (is devices-setup done?)" }
```

Note for the executor: RouterOS function locals (`:local clean do={ ... }`) cannot see the caller's locals, which is why `$flush` takes `items` and `count` as `$1`/`$2` but reads `$url`, `$secret` and `$stamp` from the surrounding scope. On RouterOS 7 a `do={}` local can read enclosing `:local`s declared before it; if the router logs "undefined variable", declare `url`, `secret` and `stamp` as `:global` for the duration of the script and unset them at the end.

- [ ] **Step 3: Install on the router and watch the log**

In WinBox (or via SSH with the exact same commands the file headers give): add both scripts, run `devices-setup` once, run `devices-push` once, then check **Log** for `devices-push: sent N devices`. Confirm rows land:

```bash
psql "$DATABASE_URL" -c "SELECT mac, hostname, ip, last_seen FROM devices ORDER BY last_seen DESC;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM device_readings;"
```

Expected: one device row per active LAN host, reading count equal to the log's N. Add the scheduler.

- [ ] **Step 4: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass (no TypeScript changed; this confirms nothing regressed).

---

### Task 6: `lib/devices/usage.ts` and the rename route

**Files:**
- Create: `lib/devices/usage.ts`
- Create: `app/api/devices/[mac]/route.ts`
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts` (`errors.deviceNameTooLong`, `errors.notAMac`)

**Interfaces:**
- Consumes: `db` from `lib/db.ts`, `RangeParams` shape `{ from: Date | null; to: Date }` from `lib/stats.ts`, `BucketUnit` from `lib/range.ts`, `normaliseMac` from Task 3.
- Produces:

```ts
export interface DeviceUsage {
  mac: string; label: string; hostname: string | null; ip: string | null;
  last_seen: string; tx_bytes: number; rx_bytes: number; total_bytes: number; readings: number;
}
export interface DeviceSeriesPoint { mac: string; bucket: string; total_bytes: number; tx_bytes: number; rx_bytes: number; readings: number }
export interface DeviceRow { mac: string; name: string | null; hostname: string | null; ip: string | null; first_seen: Date; last_seen: Date }
export function getDeviceUsage(range: RangeParams, limit?: number): Promise<DeviceUsage[]>;
export function getDeviceSeries(macs: string[], range: RangeParams, bucket: BucketUnit, timezone: string): Promise<DeviceSeriesPoint[]>;
export function renameDevice(mac: string, name: string | null): Promise<DeviceRow | null>;
export function listDevices(): Promise<DeviceRow[]>;
```

(`getDeviceSeries` takes the list of MACs rather than one at a time so the chart is one query for eight devices, not eight.)

- [ ] **Step 1: Write the module**

```ts
// lib/devices/usage.ts
/**
 * Per-device traffic, aggregated in Postgres.
 *
 * The rule is the one every WAN statistic uses (see lib/stats.ts): usage
 * between two consecutive readings is the growth of the counter, or the whole
 * new value when the counter went backwards. Deltas are taken within one MAC.
 */

import { db } from "@/lib/db";
import type { BucketUnit } from "@/lib/range";
import type { RangeParams } from "@/lib/stats";

const LOOKBACK = "INTERVAL '1 hour'";

/** Per-reading deltas per device, as CTEs `r` and `d`; pg-promise named parameters. */
const DEVICE_DELTAS = `
  r AS (
    SELECT mac, recorded_at, tx_bytes, rx_bytes,
           LAG(tx_bytes) OVER w AS prev_tx,
           LAG(rx_bytes) OVER w AS prev_rx
    FROM device_readings
    WHERE (\${from} IS NULL OR recorded_at >= \${from}::timestamptz - ${LOOKBACK})
      AND recorded_at < \${to}::timestamptz
    WINDOW w AS (PARTITION BY mac ORDER BY recorded_at, id)
  ),
  d AS (
    SELECT mac, recorded_at,
           CASE WHEN prev_tx IS NULL THEN 0
                WHEN tx_bytes >= prev_tx THEN tx_bytes - prev_tx
                ELSE tx_bytes END AS tx_delta,
           CASE WHEN prev_rx IS NULL THEN 0
                WHEN rx_bytes >= prev_rx THEN rx_bytes - prev_rx
                ELSE rx_bytes END AS rx_delta
    FROM r
    WHERE (\${from} IS NULL OR recorded_at >= \${from}::timestamptz)
  )`;

export interface DeviceUsage {
  mac: string;
  /** What the page shows: the owner's name, else the DHCP hostname, else the MAC. */
  label: string;
  hostname: string | null;
  ip: string | null;
  last_seen: string;
  tx_bytes: number;
  rx_bytes: number;
  total_bytes: number;
  readings: number;
}

interface DeviceUsageRow extends Omit<DeviceUsage, "last_seen"> {
  last_seen: Date;
}

export async function getDeviceUsage(range: RangeParams, limit = 50): Promise<DeviceUsage[]> {
  const rows = await db.any<DeviceUsageRow>(
    `WITH ${DEVICE_DELTAS}
     SELECT d.mac,
            COALESCE(dv.name, dv.hostname, d.mac)      AS label,
            dv.hostname, dv.ip, dv.last_seen,
            COALESCE(SUM(tx_delta), 0)::bigint          AS tx_bytes,
            COALESCE(SUM(rx_delta), 0)::bigint          AS rx_bytes,
            COALESCE(SUM(tx_delta + rx_delta), 0)::bigint AS total_bytes,
            COUNT(*)::int                               AS readings
     FROM d
     JOIN devices dv ON dv.mac = d.mac
     GROUP BY d.mac, dv.name, dv.hostname, dv.ip, dv.last_seen
     ORDER BY total_bytes DESC, d.mac
     LIMIT \${limit}`,
    { from: range.from, to: range.to, limit },
  );
  return rows.map((r) => ({ ...r, last_seen: r.last_seen.toISOString() }));
}

export interface DeviceSeriesPoint {
  mac: string;
  /** Start of the bucket as local wall-clock time, "YYYY-MM-DDTHH:MM:SS". */
  bucket: string;
  total_bytes: number;
  tx_bytes: number;
  rx_bytes: number;
  readings: number;
}

/** Bucketed traffic for the listed devices only; buckets with no readings are absent. */
export function getDeviceSeries(
  macs: string[],
  range: RangeParams,
  bucket: BucketUnit,
  timezone: string,
): Promise<DeviceSeriesPoint[]> {
  if (macs.length === 0) return Promise.resolve([]);
  return db.any<DeviceSeriesPoint>(
    `WITH ${DEVICE_DELTAS}
     SELECT mac,
            to_char(date_trunc(\${bucket}, recorded_at AT TIME ZONE \${timezone}),
                    'YYYY-MM-DD"T"HH24:MI:SS')          AS bucket,
            COALESCE(SUM(tx_delta + rx_delta), 0)::bigint AS total_bytes,
            COALESCE(SUM(tx_delta), 0)::bigint          AS tx_bytes,
            COALESCE(SUM(rx_delta), 0)::bigint          AS rx_bytes,
            COUNT(*)::int                               AS readings
     FROM d
     WHERE mac = ANY(\${macs})
     GROUP BY 1, 2
     ORDER BY 2, 1`,
    { from: range.from, to: range.to, bucket, timezone, macs },
  );
}

export interface DeviceRow {
  mac: string;
  name: string | null;
  hostname: string | null;
  ip: string | null;
  first_seen: Date;
  last_seen: Date;
}

export function listDevices(): Promise<DeviceRow[]> {
  return db.any<DeviceRow>("SELECT * FROM devices ORDER BY last_seen DESC");
}

/** Null when no such device exists. An empty name clears the label. */
export function renameDevice(mac: string, name: string | null): Promise<DeviceRow | null> {
  return db.oneOrNone<DeviceRow>(
    "UPDATE devices SET name = $2 WHERE mac = $1 RETURNING *",
    [mac, name],
  );
}
```

- [ ] **Step 2: Write the rename route**

```ts
// app/api/devices/[mac]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, rejectUnauthenticated } from "@/lib/api";
import { normaliseMac } from "@/lib/devices/parse";
import { renameDevice } from "@/lib/devices/usage";
import type { Dictionary } from "@/lib/i18n";
import { dictionaryFromRequest } from "@/lib/i18n/request";

function bodySchema(d: Dictionary) {
  return z.object({
    name: z.string().trim().max(100, d.errors.deviceNameTooLong).nullable(),
  });
}

/** Give a device a name, or clear it with null. */
export async function PUT(request: Request, { params }: { params: Promise<{ mac: string }> }) {
  const d = dictionaryFromRequest(request);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;

  const mac = normaliseMac(decodeURIComponent((await params).mac));
  if (!mac) return badRequest(d.errors.notAMac);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(d.errors.badJson);
  }
  const parsed = bodySchema(d).safeParse(body);
  if (!parsed.success) {
    return badRequest(d.errors.validationFailed, z.flattenError(parsed.error).fieldErrors);
  }

  try {
    const row = await renameDevice(mac, parsed.data.name || null);
    if (!row) return NextResponse.json({ error: "not_found", message: d.errors.deviceNotFound }, { status: 404 });
    return NextResponse.json({
      mac: row.mac,
      name: row.name,
      hostname: row.hostname,
      ip: row.ip,
      last_seen: row.last_seen.toISOString(),
    });
  } catch (err) {
    return errorResponse(err, d);
  }
}
```

- [ ] **Step 3: Dictionary error keys**

In `en.ts` under `errors`, after `notASessionId`:

```ts
    notAMac: "That is not a MAC address.",
    deviceNameTooLong: "The device name must be 100 characters or fewer.",
    deviceNotFound: "No device with that address has been reported.",
```

In `ar.ts` under `errors`, same position:

```ts
    notAMac: "هذا ليس عنوان MAC.",
    deviceNameTooLong: "يجب ألا يتجاوز اسم الجهاز 100 حرف.",
    deviceNotFound: "لم يُبلَّغ عن أي جهاز بهذا العنوان.",
```

- [ ] **Step 4: Try the route by hand**

Sign in in the browser, then from its devtools console:

```js
fetch("/api/devices/34:5A:60:70:A4:33", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Bilal PC" }) }).then(r => r.json()).then(console.log)
```

Expected: the row with `name: "Bilal PC"`. `psql -c "SELECT mac, name FROM devices"` agrees.

- [ ] **Step 5: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass.

---

### Task 7: The Devices page, table and navigation

**Files:**
- Create: `app/[lang]/(app)/devices/page.tsx`
- Create: `components/DeviceTable.tsx`
- Modify: `components/Nav.tsx`
- Modify: `app/[lang]/(app)/layout.tsx`
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts` (`nav.devices`, `devices.*`)

**Interfaces:**
- Consumes: `getDeviceUsage` (Task 6), `RangePicker`, `resolveRange`, `getSettings`, `getI18n`, `StatTiles`/`Card` from `components/stats/chrome.tsx`.
- Produces: `Nav` prop `devicesEnabled: boolean`; `DeviceTable` props `{ devices: DeviceUsage[]; timezone: string }`.

- [ ] **Step 1: Dictionary keys**

In `en.ts`, `nav` gains `devices: "Devices",`. Add a new top-level section after `sessions`:

```ts
  devices: {
    title: "Devices",
    subtitle: "Traffic per LAN device as the router counted it. Times in {timezone}.",
    disabledTitle: "Per-device tracking is off",
    disabledBody:
      "Turn it on under Settings > Router, then run {setup} once on the router and add the {script} script with a one-minute scheduler. Both files are in the repository's router folder.",
    empty: "No device readings in this range. They appear a minute after the devices-push script first runs.",
    device: "Device",
    lastSeen: "Last seen",
    rename: "Rename",
    saveName: "Save",
    cancel: "Cancel",
    namePlaceholder: "Name shown for this device",
    renamed: "Device renamed.",
    renameFailed: "Rename failed: {reason}",
    devicesCount: plural({ one: "{count} device", other: "{count} devices" }),
    topDevices: "Top {count} devices over time",
    others: "Others",
    chartHint: "download and upload combined, in GB",
    tiles: {
      total: "Total across devices",
      devices: "Devices seen",
      busiest: "Busiest device",
      share: "of the total",
    },
  },
```

In `ar.ts`, `nav` gains `devices: "الأجهزة",` and the section:

```ts
  devices: {
    title: "الأجهزة",
    subtitle: "الاستهلاك لكل جهاز على الشبكة المحلية كما عدّه الراوتر. الأوقات بتوقيت {timezone}.",
    disabledTitle: "تتبع الأجهزة متوقف",
    disabledBody:
      "فعّله من الإعدادات > الراوتر، ثم شغّل {setup} مرة واحدة على الراوتر وأضف سكربت {script} مع مجدول كل دقيقة. الملفان في مجلد router في المستودع.",
    empty: "لا قراءات للأجهزة في هذه الفترة. تظهر بعد دقيقة من أول تشغيل لسكربت devices-push.",
    device: "الجهاز",
    lastSeen: "آخر ظهور",
    rename: "إعادة تسمية",
    saveName: "حفظ",
    cancel: "إلغاء",
    namePlaceholder: "الاسم الذي يظهر لهذا الجهاز",
    renamed: "تمت إعادة تسمية الجهاز.",
    renameFailed: "فشلت إعادة التسمية: {reason}",
    devicesCount: plural({
      zero: "لا أجهزة",
      one: "جهاز واحد",
      two: "جهازان",
      few: "{count} أجهزة",
      many: "{count} جهازاً",
      other: "{count} جهاز",
    }),
    topDevices: "أكثر {count} أجهزة استهلاكاً عبر الوقت",
    others: "أخرى",
    chartHint: "التنزيل والرفع معاً، بالجيجابايت",
    tiles: {
      total: "الإجمالي عبر الأجهزة",
      devices: "الأجهزة المرصودة",
      busiest: "الجهاز الأكثر استهلاكاً",
      share: "من الإجمالي",
    },
  },
```

- [ ] **Step 2: The table (client component)**

```tsx
// components/DeviceTable.tsx
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Toast, type ToastState } from "@/components/Toast";
import { formatBytes } from "@/lib/format";
import { fill } from "@/lib/i18n";
import type { DeviceUsage } from "@/lib/devices/usage";

const inputClass =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-series-1 focus:ring-2 focus:ring-series-1/30";
const buttonClass = "rounded-md border border-border px-2 py-1 text-xs hover:bg-border/60 disabled:opacity-50";

/**
 * One row per device with an inline rename. The name is saved through
 * /api/devices/[mac] and the page is refreshed so the server-rendered label,
 * chart legend and tiles all pick it up at once.
 */
export function DeviceTable({ devices, timezone }: { devices: DeviceUsage[]; timezone: string }) {
  const { locale, d, f } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismiss = useCallback(() => setToast(null), []);

  function startEdit(device: DeviceUsage) {
    setEditing(device.mac);
    setDraft(device.label === device.mac ? "" : device.label);
  }

  async function save(mac: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(mac)}?lang=${locale}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: draft.trim() === "" ? null : draft.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? fill(d.settings.httpError, { status: res.status }));
      }
      setEditing(null);
      setToast({ kind: "success", message: d.devices.renamed });
      router.refresh();
    } catch (err) {
      setToast({
        kind: "error",
        message: fill(d.devices.renameFailed, { reason: err instanceof Error ? err.message : String(err) }),
      });
    } finally {
      setSaving(false);
    }
  }

  if (devices.length === 0) {
    return <p className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">{d.devices.empty}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-border">
            <th className="px-4 py-2 text-start font-medium">{d.devices.device}</th>
            <th className="px-4 py-2 text-end font-medium">{d.common.download}</th>
            <th className="px-4 py-2 text-end font-medium">{d.common.upload}</th>
            <th className="px-4 py-2 text-end font-medium">{d.common.total}</th>
            <th className="px-4 py-2 text-end font-medium">{d.devices.lastSeen}</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.mac} className="border-b border-border last:border-0">
              <td className="px-4 py-2">
                {editing === device.mac ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save(device.mac);
                    }}
                  >
                    <input
                      autoFocus
                      value={draft}
                      maxLength={100}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={d.devices.namePlaceholder}
                      className={inputClass}
                    />
                    <button type="submit" disabled={saving} className={buttonClass}>
                      {d.devices.saveName}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className={buttonClass}>
                      {d.devices.cancel}
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="font-medium">{device.label}</div>
                    {/* Identifiers stay ltr in Arabic; a MAC read right to left is a different MAC. */}
                    <div className="font-mono text-xs text-muted" dir="ltr">
                      {device.mac}
                      {device.ip ? ` · ${device.ip}` : ""}
                      {device.hostname && device.hostname !== device.label ? ` · ${device.hostname}` : ""}
                    </div>
                  </>
                )}
              </td>
              <td className="px-4 py-2 text-end tabular-nums">{formatBytes(device.rx_bytes)}</td>
              <td className="px-4 py-2 text-end tabular-nums">{formatBytes(device.tx_bytes)}</td>
              <td className="px-4 py-2 text-end font-medium tabular-nums">{formatBytes(device.total_bytes)}</td>
              <td className="px-4 py-2 text-end text-xs tabular-nums text-muted">
                {f.stamp(device.last_seen, timezone)}
              </td>
              <td className="px-4 py-2 text-end">
                {editing !== device.mac && (
                  <button type="button" onClick={() => startEdit(device)} className={buttonClass}>
                    {d.devices.rename}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}
```

- [ ] **Step 3: The page**

```tsx
// app/[lang]/(app)/devices/page.tsx
import type { Metadata } from "next";
import { connection } from "next/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DeviceTable } from "@/components/DeviceTable";
import { RangePicker } from "@/components/RangePicker";
import { StatTiles, type Tile } from "@/components/stats/chrome";
import { getDeviceUsage } from "@/lib/devices/usage";
import { formatBytes } from "@/lib/format";
import { fill, plural } from "@/lib/i18n";
import { Interpolate } from "@/lib/i18n/react";
import { getI18n } from "@/lib/i18n/server";
import { DEFAULT_PRESET, InvalidRangeError, rangeErrorMessage, resolveRange } from "@/lib/range";
import { getSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.devices.title} - ${d.meta.appName}` };
}

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export default async function DevicesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();

  const { locale, d } = await getI18n();
  const params = await searchParams;
  const settings = await getSettings();

  if (!settings.devices_enabled) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight">{d.devices.title}</h1>
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-semibold">{d.devices.disabledTitle}</h2>
          <p className="mt-2 text-sm text-muted">
            <Interpolate
              template={d.devices.disabledBody}
              values={{ setup: <code>devices-setup.rsc</code>, script: <code>devices-push</code> }}
            />
          </p>
        </section>
      </div>
    );
  }

  const options = { timezone: settings.timezone, cycleDay: settings.billing_cycle_day };
  let rangeError: string | null = null;
  let range;
  try {
    range = resolveRange(
      { range: one(params.range) ?? "today", from: one(params.from), to: one(params.to) },
      options,
    );
  } catch (err) {
    if (!(err instanceof InvalidRangeError)) throw err;
    rangeError = rangeErrorMessage(d, err);
    range = resolveRange({ range: DEFAULT_PRESET }, options);
  }

  const window = { from: range.from, to: range.to };
  const devices = await getDeviceUsage(window, 50);
  const total = devices.reduce((sum, device) => sum + device.total_bytes, 0);
  const busiest = devices[0] ?? null;

  const tiles: Tile[] = [
    { label: d.devices.tiles.total, value: formatBytes(total) },
    { label: d.devices.tiles.devices, value: plural(locale, d.devices.devicesCount, devices.length) },
    {
      label: d.devices.tiles.busiest,
      value: busiest ? busiest.label : d.common.empty,
      hint: busiest && total > 0 ? `${Math.round((busiest.total_bytes / total) * 100)}% ${d.devices.tiles.share}` : undefined,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{d.devices.title}</h1>
          <p className="text-sm text-muted">{fill(d.devices.subtitle, { timezone: settings.timezone })}</p>
        </div>
        <AutoRefresh seconds={60} />
      </div>

      <RangePicker preset={range.preset} from={range.from_input} to={range.to_input} />

      {rangeError && (
        <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm">
          {fill(d.rangePicker.fallback, { reason: rangeError })}
        </p>
      )}

      <StatTiles tiles={tiles} columns={3} />

      <DeviceTable devices={devices} timezone={settings.timezone} />
    </div>
  );
}
```

- [ ] **Step 4: Navigation, shown only when enabled**

In `components/Nav.tsx`, insert the devices entry into `LINKS` directly after the sessions entry, keeping any entries other plans added (plan 01 adds `/alerts` there too), and change the signature:

```tsx
  { path: "/devices", label: (d: Dictionary) => d.nav.devices, needsDevices: true },
```

```tsx
export function Nav({ username, devicesEnabled }: { username: string; devicesEnabled: boolean }) {
```

On the current file (before other plans) the result is:

```tsx
const LINKS = [
  { path: "", label: (d: Dictionary) => d.nav.dashboard },
  { path: "/stats", label: (d: Dictionary) => d.nav.statistics },
  { path: "/sessions", label: (d: Dictionary) => d.nav.sessions },
  { path: "/devices", label: (d: Dictionary) => d.nav.devices, needsDevices: true },
  { path: "/settings", label: (d: Dictionary) => d.nav.settings },
  { path: "/export", label: (d: Dictionary) => d.nav.export },
] as const;

export function Nav({ username, devicesEnabled }: { username: string; devicesEnabled: boolean }) {
```

and in the render, map over `LINKS.filter((link) => !("needsDevices" in link) || devicesEnabled)` instead of `LINKS`.

In `app/[lang]/(app)/layout.tsx`:

```tsx
import { Nav } from "@/components/Nav";
import { requireAuth } from "@/lib/auth/server";
import { Interpolate } from "@/lib/i18n/react";
import { getI18n } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ d }, auth, devicesEnabled] = await Promise.all([
    getI18n(),
    requireAuth(),
    // The dashboard explains a missing settings row itself; the header must
    // not be the thing that breaks first.
    getSettings().then((s) => s.devices_enabled, () => false),
  ]);

  return (
    <>
      <Nav username={auth.user.username} devicesEnabled={devicesEnabled} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-6 text-xs text-zinc-500 sm:px-6">
        <Interpolate template={d.footer.ingest} values={{ path: <code>/api/ingest</code> }} />
      </footer>
    </>
  );
}
```

- [ ] **Step 5: Check in the browser**

Open `/en/devices` with tracking off: the explanation card. Turn it on in settings: the nav link appears, the page lists devices for today, rename works and survives a reload, `/ar/devices` reads right to left with MACs still left to right.

- [ ] **Step 6: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass, including the dictionary parity tests.

---

### Task 8: Stacked chart of the top eight devices

**Files:**
- Create: `components/DeviceChart.tsx`
- Create: `lib/devices/chart.ts`
- Test: `lib/devices/chart.test.ts`
- Modify: `app/globals.css` (series colours 4 to 8)
- Modify: `app/[lang]/(app)/devices/page.tsx`

**Interfaces:**
- Consumes: `getDeviceSeries` (Task 6), `formatBucketLabel`/`formatBucketTitle` from `lib/series.ts`, `Card`, `Legend`, `Empty`, `AXIS`, `chartMargin`, `valueAxisSide`, `gbTickFormatter`, `TooltipShell`, `TooltipRow` from `components/stats/chrome.tsx`.
- Produces:

```ts
// lib/devices/chart.ts
export const TOP_DEVICES = 8;
export const OTHERS_KEY = "__others__";
export interface StackedRow { bucket: string; [mac: string]: number | string }
/** Rows per bucket with one numeric column per top MAC plus OTHERS_KEY, values in GB. */
export function stackDeviceSeries(points: DeviceSeriesPoint[], topMacs: string[]): StackedRow[];
```

- [ ] **Step 1: Write the failing test**

```ts
// lib/devices/chart.test.ts
import { describe, expect, test } from "vitest";
import { OTHERS_KEY, stackDeviceSeries } from "@/lib/devices/chart";
import type { DeviceSeriesPoint } from "@/lib/devices/usage";

function point(mac: string, bucket: string, total: number): DeviceSeriesPoint {
  return { mac, bucket, total_bytes: total, tx_bytes: 0, rx_bytes: total, readings: 1 };
}

describe("stackDeviceSeries", () => {
  test("one row per bucket, one GB column per top device, zero where absent", () => {
    const rows = stackDeviceSeries(
      [point("A", "2026-09-01T00:00:00", 2e9), point("B", "2026-09-01T00:00:00", 1e9), point("A", "2026-09-02T00:00:00", 5e8)],
      ["A", "B"],
    );
    expect(rows).toEqual([
      { bucket: "2026-09-01T00:00:00", A: 2, B: 1, [OTHERS_KEY]: 0 },
      { bucket: "2026-09-02T00:00:00", A: 0.5, B: 0, [OTHERS_KEY]: 0 },
    ]);
  });

  test("devices outside the top list are summed into Others", () => {
    const rows = stackDeviceSeries(
      [point("A", "2026-09-01T00:00:00", 1e9), point("C", "2026-09-01T00:00:00", 3e8), point("D", "2026-09-01T00:00:00", 2e8)],
      ["A"],
    );
    expect(rows[0][OTHERS_KEY]).toBeCloseTo(0.5);
  });

  test("buckets come out in chronological order whatever the input order", () => {
    const rows = stackDeviceSeries(
      [point("A", "2026-09-02T00:00:00", 1), point("A", "2026-09-01T00:00:00", 1)],
      ["A"],
    );
    expect(rows.map((r) => r.bucket)).toEqual(["2026-09-01T00:00:00", "2026-09-02T00:00:00"]);
  });

  test("no points gives no rows", () => {
    expect(stackDeviceSeries([], ["A"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run lib/devices/chart.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the shaping**

```ts
// lib/devices/chart.ts
import type { DeviceSeriesPoint } from "@/lib/devices/usage";
import { bytesToGb } from "@/lib/format";

export const TOP_DEVICES = 8;
/** Column name for everything outside the top list; no MAC can collide with it. */
export const OTHERS_KEY = "__others__";

export interface StackedRow {
  bucket: string;
  [mac: string]: number | string;
}

/**
 * Pivot per-device points into one row per bucket for a stacked chart. Every
 * top MAC gets a column in every row, zero when the device was quiet, so the
 * stack never shifts colours between neighbouring bars.
 */
export function stackDeviceSeries(points: DeviceSeriesPoint[], topMacs: string[]): StackedRow[] {
  const top = new Set(topMacs);
  const rows = new Map<string, StackedRow>();
  for (const p of points) {
    let row = rows.get(p.bucket);
    if (!row) {
      row = { bucket: p.bucket, [OTHERS_KEY]: 0 };
      for (const mac of topMacs) row[mac] = 0;
      rows.set(p.bucket, row);
    }
    const key = top.has(p.mac) ? p.mac : OTHERS_KEY;
    row[key] = (row[key] as number) + bytesToGb(p.total_bytes);
  }
  return [...rows.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run lib/devices/chart.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Five more series colours**

`app/globals.css` defines only `--series-1`, `--series-2` and `--series-3` (and their `--color-series-*` aliases). Eight stacked devices plus "Others" need nine. In the light `:root` block, after `--series-3: #1baf7a;` add:

```css
  --series-4: #7c5cff;
  --series-5: #d6409f;
  --series-6: #0f9bb5;
  --series-7: #b7791f;
  --series-8: #64748b;
```

In the dark block after `--series-3: #199e70;` add:

```css
  --series-4: #9d85ff;
  --series-5: #e26ab8;
  --series-6: #2bb8d3;
  --series-7: #d3963a;
  --series-8: #94a3b8;
```

In the `@theme` mapping after `--color-series-3: var(--series-3);` add:

```css
  --color-series-4: var(--series-4);
  --color-series-5: var(--series-5);
  --color-series-6: var(--series-6);
  --color-series-7: var(--series-7);
  --color-series-8: var(--series-8);
```

"Others" uses `var(--border)` so it reads as background, not as a ninth device.

- [ ] **Step 6: The chart component**

```tsx
// components/DeviceChart.tsx
"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { useI18n } from "@/components/I18nProvider";
import {
  AXIS,
  Card,
  Empty,
  Legend,
  TooltipRow,
  TooltipShell,
  chartMargin,
  gbTickFormatter,
  valueAxisSide,
} from "@/components/stats/chrome";
import { OTHERS_KEY, type StackedRow } from "@/lib/devices/chart";
import { fill } from "@/lib/i18n";
import type { BucketUnit } from "@/lib/range";
import { formatBucketLabel, formatBucketTitle } from "@/lib/series";

export interface DeviceSeriesEntry {
  mac: string;
  label: string;
}

const COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--series-${n})`);
const OTHERS_COLOR = "var(--border)";

/**
 * Daily (or hourly) traffic stacked by device. Colour identifies a device only
 * within this chart; the legend carries the names so identity never rests on
 * colour alone.
 */
export function DeviceChart({
  rows,
  devices,
  bucket,
  hasOthers,
}: {
  rows: StackedRow[];
  devices: DeviceSeriesEntry[];
  bucket: BucketUnit;
  hasOthers: boolean;
}) {
  const { d, dir } = useI18n();
  const labelOf = new Map(devices.map((dev, i) => [dev.mac, { label: dev.label, color: COLORS[i] }]));
  const data = rows.map((r) => ({ ...r, label: formatBucketLabel(r.bucket, bucket, d) }));
  const maxGb = Math.max(
    0,
    ...rows.map((r) => devices.reduce((sum, dev) => sum + (r[dev.mac] as number), r[OTHERS_KEY] as number)),
  );

  function ChartTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as StackedRow;
    return (
      <TooltipShell title={formatBucketTitle(row.bucket, bucket, d)}>
        {devices.map((dev) => (
          <TooltipRow
            key={dev.mac}
            label={dev.label}
            value={`${(row[dev.mac] as number).toFixed(2)} GB`}
            color={labelOf.get(dev.mac)!.color}
          />
        ))}
        {hasOthers && (
          <TooltipRow label={d.devices.others} value={`${(row[OTHERS_KEY] as number).toFixed(2)} GB`} color={OTHERS_COLOR} />
        )}
      </TooltipShell>
    );
  }

  const legend = devices.map((dev) => ({ label: dev.label, color: labelOf.get(dev.mac)!.color }));
  if (hasOthers) legend.push({ label: d.devices.others, color: OTHERS_COLOR });

  return (
    <Card title={fill(d.devices.topDevices, { count: devices.length })} hint={d.devices.chartHint}>
      {rows.length === 0 ? (
        <Empty>{d.devices.empty}</Empty>
      ) : (
        <>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={chartMargin(dir)}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
                <YAxis
                  orientation={valueAxisSide(dir)}
                  {...AXIS}
                  width={36}
                  tickFormatter={gbTickFormatter(maxGb)}
                />
                <Tooltip content={ChartTooltip} cursor={{ fill: "var(--border)", opacity: 0.4 }} />
                {devices.map((dev) => (
                  <Bar key={dev.mac} dataKey={dev.mac} stackId="a" fill={labelOf.get(dev.mac)!.color} />
                ))}
                {hasOthers && <Bar dataKey={OTHERS_KEY} stackId="a" fill={OTHERS_COLOR} radius={[3, 3, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3">
            <Legend items={legend} />
          </div>
        </>
      )}
    </Card>
  );
}
```

- [ ] **Step 7: Feed it from the page**

In `app/[lang]/(app)/devices/page.tsx` add the imports:

```tsx
import { DeviceChart } from "@/components/DeviceChart";
import { stackDeviceSeries, TOP_DEVICES } from "@/lib/devices/chart";
import { getDeviceSeries } from "@/lib/devices/usage";
```

Replace `const devices = await getDeviceUsage(window, 50);` with:

```tsx
  const devices = await getDeviceUsage(window, 50);
  // A minute-level bucket over a whole day is 1,440 stacks of eight; hours are
  // the finest the chart draws, whatever the range picker chose.
  const bucket = range.bucket === "minute" ? "hour" : range.bucket;
  const top = devices.slice(0, TOP_DEVICES);
  const series = await getDeviceSeries(
    devices.map((device) => device.mac),
    window,
    bucket,
    settings.timezone,
  );
  const rows = stackDeviceSeries(series, top.map((device) => device.mac));
```

(The two queries stay sequential because the second needs the first's MAC list; one extra round trip is acceptable on this page.)

Between `<StatTiles ... />` and `<DeviceTable ... />` add:

```tsx
      <DeviceChart
        rows={rows}
        devices={top.map((device) => ({ mac: device.mac, label: device.label }))}
        bucket={bucket}
        hasOthers={devices.length > top.length}
      />
```

- [ ] **Step 8: Check in the browser**

`/en/devices?range=last_7d`: one stacked bar per day, legend names match the table, tooltip shows GB per device, "Others" appears only with more than eight devices. `/ar/devices`: value axis on the right, bars still oldest to newest.

- [ ] **Step 9: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass.

---

### Task 9: README

**Files:**
- Modify: `README.md` (new section after "Starting a fresh session on purpose")

**Interfaces:** none.

- [ ] **Step 1: Write the section**

```markdown
### Per-device usage

Off by default. When enabled on `/settings` (Router section), a second router script
reports every LAN device's counters once a minute and `/devices` shows who used what,
with a stacked chart of the top eight and a rename box for each device.

Preconditions, all verified on a hEX lite running RouterOS 7.24.2:

- The counters come from `/ip kid-control device`, which RouterOS only fills once at
  least one kid-control entry exists. `router/devices-setup.rsc` adds a placeholder
  entry named `all-devices` that restricts nothing.
- Kid-control counts inside the firewall, and the default fasttrack rule lets
  established connections skip the firewall. The setup script therefore disables the
  `defconf: fasttrack` rule. On a hEX lite this raises CPU load noticeably under heavy
  traffic; it is the price of per-device figures. To go back, run the two undo lines at
  the bottom of the setup script and turn the setting off.
- A downstream router in NAT mode (an Archer AX55 Pro on this network) hides its clients
  behind one MAC. Only devices the MikroTik hands addresses to appear separately. In
  access-point mode every client shows up on its own.

Setup:

1. Run `router/devices-setup.rsc` once.
2. Add `router/devices-push.rsc` as a script with policies `read, test`, fill in `url`
   (`.../api/ingest/devices`) and `secret` (the same `CRON_SECRET`), and schedule it every
   minute. The log line `devices-push: sent N devices` confirms it.
3. Turn on per-device tracking on `/settings`. The Devices link appears in the header.

Names come from the DHCP lease's host-name; rename any device on the page. Usage is the
growth of each device's counter between pushes, so a router reboot loses at most one
minute. Pushes are batched at 200 devices.
```

- [ ] **Step 2: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass.

---

## Self-review

- Spec coverage: contract 7 tables and endpoint (Tasks 2, 4), settings column (Task 2), parse module (Task 3), router scripts with 200-device batches (Task 5), usage queries and rename (Task 6), page, table, conditional nav (Task 7), chart with stated colour count (Task 8), README preconditions and limits (Task 9), on-router verification first (Task 1).
- Deviation from the parent brief, stated: `getDeviceSeries` takes a MAC list rather than one MAC, so the chart is one query.
- Type consistency: `DeviceUsage.label`, `DeviceSeriesPoint.bucket`, `StackedRow`, `OTHERS_KEY` and `TOP_DEVICES` are used with the same names in Tasks 6, 7 and 8. `normaliseMac` from Task 3 is what Task 6's route uses. `Nav`'s `devicesEnabled` prop is supplied by the layout in Task 7.
