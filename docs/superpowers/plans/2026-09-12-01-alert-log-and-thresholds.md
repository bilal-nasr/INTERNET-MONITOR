# Alert Log and Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every alert the app sends is recorded in an `alerts` table and shown on an Alerts page; the daily quota mails at configurable percent marks (50, 80, 100 by default) instead of only at 100 %; the monthly cap mails at its own marks and once when the projection first crosses the cap.

**Architecture:** One dispatcher (`lib/alerts/dispatch.ts`) sends a rendered email and writes the log row, so the log can never disagree with what went out. Threshold selection is a pure function (`lib/alerts/thresholds.ts`) shared by the daily and the cycle check. The daily check stays inside `recordReading` (it already owns the `daily_windows` row); the cycle check is a new module called from the ingest route after the reading is stored, throttled to one database aggregate per five minutes. The existing alert template gains threshold wording; cycle mails get a small template of their own.

**Tech Stack:** Next.js 16 App Router, TypeScript, Postgres via pg-promise, Resend, zod 4, vitest, Tailwind 4.

**Spec:** `docs/superpowers/plans/2026-09-12-00-roadmap.md` (contracts 1, 2, 3, 4 and 9).

## Global Constraints

- Every user-visible string is a dictionary key in `lib/i18n/dictionaries/en.ts` with an Arabic entry in `ar.ts`; `lib/i18n.test.ts` fails otherwise.
- Schema changes are idempotent statements appended to the migrations section of `schema.sql`; the file must run clean on an empty database and on the current production one.
- Route Handlers gate with `rejectUnauthenticated(request, d)` and answer errors with `errorResponse(err, d)` / `badRequest(...)` from `lib/api.ts`.
- Pure logic lives in its own module with a vitest file under `lib/`; database access stays thin and untested.
- **No commits.** The user commits manually. A task is done when `pnpm test`, `pnpm lint` and `pnpm exec tsc --noEmit` all pass.
- Names from the roadmap are fixed: `alerts`, `cycle_alerts`, `daily_windows.notified_level`, `alert_thresholds`, `cycle_alert_thresholds`, `cycle_pace_alert`, `AlertKind`, `recordAlert`, `listAlerts`, `latestAlert`, `dispatchAlert`, `sendRendered`, `nextThreshold`, `isThresholdList`, `paceCrossesCap`.

---

### Task 1: Schema migrations

**Files:**
- Modify: `schema.sql` (migrations section, after the `language` ALTER; and the DO block; and the indexes section)

**Interfaces:**
- Produces: tables `alerts`, `cycle_alerts`; column `daily_windows.notified_level`; settings columns `alert_thresholds INTEGER[]`, `cycle_alert_thresholds INTEGER[]`, `cycle_pace_alert BOOLEAN`.

- [ ] **Step 1: Add the tables and columns to the migrations section**

Insert after the line `ALTER TABLE settings ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';` in `schema.sql`:

```sql
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
```

- [ ] **Step 2: Add the CHECK constraints to the DO block**

Inside the existing `DO $$ ... END $$;` block, before `END`, add:

```sql
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_alert_thresholds_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_alert_thresholds_check
      CHECK (cardinality(alert_thresholds) BETWEEN 0 AND 8);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_cycle_alert_thresholds_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_cycle_alert_thresholds_check
      CHECK (cardinality(cycle_alert_thresholds) BETWEEN 0 AND 8);
  END IF;
```

- [ ] **Step 3: Add the indexes**

In the indexes section, after `CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ...`:

```sql
CREATE INDEX IF NOT EXISTS alerts_created_at_idx ON alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_kind_scope_idx ON alerts (kind, scope_key);
```

- [ ] **Step 4: Apply and verify**

Run against the development database (the DATABASE_URL in `.env.local`):

```bash
psql "$DATABASE_URL" -f schema.sql
psql "$DATABASE_URL" -c "\d alerts" -c "\d cycle_alerts" -c "SELECT alert_thresholds, cycle_alert_thresholds, cycle_pace_alert FROM settings"
```

Expected: both tables listed; the settings row shows `{50,80,100}`, `{80,100}`, `t`. Run the file a second time and confirm it exits 0 with no errors.

---

### Task 2: Threshold selection, pure

**Files:**
- Create: `lib/alerts/thresholds.ts`
- Test: `lib/alerts/thresholds.test.ts`

**Interfaces:**
- Produces:
  - `nextThreshold(percent: number, notifiedLevel: number, thresholds: number[]): number | null`
  - `isThresholdList(value: unknown): value is number[]`
  - `MAX_THRESHOLDS = 8`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/alerts/thresholds.test.ts
import { describe, expect, test } from "vitest";
import { isThresholdList, nextThreshold } from "@/lib/alerts/thresholds";

const MARKS = [50, 80, 100];

describe("nextThreshold", () => {
  test("says nothing below the first mark", () => {
    expect(nextThreshold(49.9, 0, MARKS)).toBeNull();
  });

  test("fires exactly on a mark", () => {
    expect(nextThreshold(50, 0, MARKS)).toBe(50);
  });

  test("folds skipped marks into the highest one reached", () => {
    // 40 % to 95 % in one push: one 80 % mail, not a 50 % and an 80 %.
    expect(nextThreshold(95, 0, MARKS)).toBe(80);
  });

  test("does not repeat a mark already notified", () => {
    expect(nextThreshold(85, 80, MARKS)).toBeNull();
  });

  test("moves on to the next mark after the last one notified", () => {
    expect(nextThreshold(101, 80, MARKS)).toBe(100);
  });

  test("keeps firing above 100 only for marks not yet sent", () => {
    expect(nextThreshold(250, 100, MARKS)).toBeNull();
  });

  test("returns null for an empty list", () => {
    expect(nextThreshold(200, 0, [])).toBeNull();
  });

  test("tolerates an unsorted list by picking the highest reached", () => {
    expect(nextThreshold(85, 0, [100, 50, 80])).toBe(80);
  });
});

describe("isThresholdList", () => {
  test("accepts the default", () => {
    expect(isThresholdList([50, 80, 100])).toBe(true);
  });

  test("accepts an empty list (alerts off)", () => {
    expect(isThresholdList([])).toBe(true);
  });

  test("rejects an unsorted list", () => {
    expect(isThresholdList([80, 50])).toBe(false);
  });

  test("rejects duplicates", () => {
    expect(isThresholdList([50, 50, 100])).toBe(false);
  });

  test("rejects more than eight marks", () => {
    expect(isThresholdList([10, 20, 30, 40, 50, 60, 70, 80, 90])).toBe(false);
  });

  test("rejects non-integers, zero, and values over 100", () => {
    expect(isThresholdList([50.5])).toBe(false);
    expect(isThresholdList([0, 50])).toBe(false);
    expect(isThresholdList([50, 101])).toBe(false);
  });

  test("rejects things that are not arrays of numbers", () => {
    expect(isThresholdList("50,80")).toBe(false);
    expect(isThresholdList([50, "80"])).toBe(false);
    expect(isThresholdList(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run lib/alerts/thresholds.test.ts`
Expected: FAIL, "Cannot find module '@/lib/alerts/thresholds'".

- [ ] **Step 3: Implement**

```ts
// lib/alerts/thresholds.ts
/**
 * Which alert mark, if any, a usage figure has just reached.
 *
 * Marks are percentages of a quota. A day (or a cycle) remembers the highest
 * mark already mailed; the next mail goes out only for a higher mark. When one
 * push jumps past several marks at once, only the highest is reported, so a
 * burst of traffic produces one mail rather than a backlog.
 */

export const MAX_THRESHOLDS = 8;

export function nextThreshold(
  percent: number,
  notifiedLevel: number,
  thresholds: number[],
): number | null {
  let best: number | null = null;
  for (const mark of thresholds) {
    if (mark > notifiedLevel && percent >= mark && (best === null || mark > best)) {
      best = mark;
    }
  }
  return best;
}

/** Integers 1..100, strictly ascending, at most MAX_THRESHOLDS of them. */
export function isThresholdList(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length > MAX_THRESHOLDS) return false;
  let previous = 0;
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item)) return false;
    if (item < 1 || item > 100 || item <= previous) return false;
    previous = item;
  }
  return true;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run lib/alerts/thresholds.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

---

### Task 3: Threshold settings end to end

**Files:**
- Modify: `lib/settings.ts` (SettingsRow, PublicSettings, SettingsPatch, WRITABLE, loadSettings SELECT, toPublicSettings)
- Modify: `app/api/settings/route.ts` (patchSchema)
- Modify: `components/SettingsForm.tsx` (FormState, toForm, onSubmit payload, Alerts section)
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts`

**Interfaces:**
- Consumes: `isThresholdList`, `MAX_THRESHOLDS` from Task 2.
- Produces: `SettingsRow.alert_thresholds: number[]`, `SettingsRow.cycle_alert_thresholds: number[]`, `SettingsRow.cycle_pace_alert: boolean` (same three on `PublicSettings` and `SettingsPatch`).

- [ ] **Step 1: Extend the settings types and queries**

In `lib/settings.ts`:

```ts
// SettingsRow: add after `language: string;`
  /** Percent marks of the daily quota that trigger a mail. Ascending, 1..100. */
  alert_thresholds: number[];
  /** Percent marks of the monthly cap that trigger a mail. */
  cycle_alert_thresholds: number[];
  /** One mail per cycle when the projection first crosses the cap. */
  cycle_pace_alert: boolean;

// PublicSettings: add after `language: string;`
  alert_thresholds: number[];
  cycle_alert_thresholds: number[];
  cycle_pace_alert: boolean;

// SettingsPatch's Pick union: add
    | "alert_thresholds"
    | "cycle_alert_thresholds"
    | "cycle_pace_alert"

// WRITABLE set: add
  "alert_thresholds",
  "cycle_alert_thresholds",
  "cycle_pace_alert",
```

In the SELECT in `loadSettings`, add `alert_thresholds, cycle_alert_thresholds, cycle_pace_alert` to the column list just before `updated_at`. Keep every column already listed, including any another plan added. On the current file the result is:

```ts
    `SELECT id, quota_gb, monthly_quota_gb, billing_cycle_day, window_start,
            window_end, timezone, alert_email_to, wan_interface_name,
            polling_enabled, language, alert_thresholds, cycle_alert_thresholds,
            cycle_pace_alert, updated_at
     FROM settings WHERE id = 1`,
```

In `toPublicSettings` add before `updated_at`:

```ts
    alert_thresholds: row.alert_thresholds,
    cycle_alert_thresholds: row.cycle_alert_thresholds,
    cycle_pace_alert: row.cycle_pace_alert,
```

Note: node-postgres parses `INTEGER[]` into `number[]` on its own, and pg-promise formats a JS `number[]` as `array[50,80,100]`, so `updateSettings` needs no change.

- [ ] **Step 2: Validate in the route**

In `app/api/settings/route.ts` import the helper and add three fields to the object inside `patchSchema`:

```ts
import { isThresholdList, MAX_THRESHOLDS } from "@/lib/alerts/thresholds";
```

```ts
      alert_thresholds: z
        .array(z.coerce.number())
        .max(MAX_THRESHOLDS, e.thresholdsInvalid)
        .refine(isThresholdList, e.thresholdsInvalid),
      cycle_alert_thresholds: z
        .array(z.coerce.number())
        .max(MAX_THRESHOLDS, e.thresholdsInvalid)
        .refine(isThresholdList, e.thresholdsInvalid),
      cycle_pace_alert: z.boolean(),
```

- [ ] **Step 3: Dictionary keys, English**

In `lib/i18n/dictionaries/en.ts`, inside `settings` after `alertLanguageHint`:

```ts
    alertThresholds: "Daily alert marks (% of quota)",
    alertThresholdsHint:
      "Comma-separated, ascending. A mail goes out when usage in the window first reaches each mark. 100 is the exceeded alert. Leave empty to turn daily mails off.",
    cycleAlertThresholds: "Monthly alert marks (% of cap)",
    cycleAlertThresholdsHint: "Same rule, measured against the monthly cap over the whole cycle.",
    cyclePaceAlert: "Warn when the projection crosses the cap",
    cyclePaceAlertHint:
      "One mail per cycle, sent the first time the projected end-of-cycle usage exceeds the cap (after the third day, so a heavy first day does not trigger it).",
```

Inside `settings.fields`:

```ts
      alert_thresholds: "Daily alert marks",
      cycle_alert_thresholds: "Monthly alert marks",
      cycle_pace_alert: "Projection warning",
```

Inside `errors` after `windowOrder`:

```ts
    thresholdsInvalid: "Alert marks must be whole numbers from 1 to 100, ascending, at most 8 of them.",
```

- [ ] **Step 4: Dictionary keys, Arabic**

In `lib/i18n/dictionaries/ar.ts`, inside `settings` after `alertLanguageHint`:

```ts
    alertThresholds: "علامات التنبيه اليومي (% من الحصة)",
    alertThresholdsHint:
      "أرقام مفصولة بفواصل وبترتيب تصاعدي. تُرسل رسالة عند بلوغ الاستهلاك داخل النافذة كل علامة للمرة الأولى. 100 هي تنبيه التجاوز. اتركها فارغة لإيقاف الرسائل اليومية.",
    cycleAlertThresholds: "علامات التنبيه الشهري (% من السقف)",
    cycleAlertThresholdsHint: "القاعدة نفسها، مقاسة على السقف الشهري طوال الدورة.",
    cyclePaceAlert: "تنبيه عندما يتجاوز التوقّع السقف",
    cyclePaceAlertHint:
      "رسالة واحدة لكل دورة، تُرسل أول مرة يتجاوز فيها الاستهلاك المتوقّع في نهاية الدورة السقف (بعد اليوم الثالث، كي لا يطلقها يوم أول ثقيل).",
```

Inside `settings.fields`:

```ts
      alert_thresholds: "علامات التنبيه اليومي",
      cycle_alert_thresholds: "علامات التنبيه الشهري",
      cycle_pace_alert: "تنبيه التوقّع",
```

Inside `errors` after `windowOrder`:

```ts
    thresholdsInvalid: "يجب أن تكون علامات التنبيه أعداداً صحيحة من 1 إلى 100، بترتيب تصاعدي، و8 علامات كحد أقصى.",
```

- [ ] **Step 5: The form**

In `components/SettingsForm.tsx`:

Add to `FormState`:

```ts
  alert_thresholds: string;
  cycle_alert_thresholds: string;
  cycle_pace_alert: boolean;
```

Add to `toForm`:

```ts
    alert_thresholds: s.alert_thresholds.join(", "),
    cycle_alert_thresholds: s.cycle_alert_thresholds.join(", "),
    cycle_pace_alert: s.cycle_pace_alert,
```

Add a module-level parser above `SettingsForm`:

```ts
/** "50, 80, 100" -> [50, 80, 100]. Blanks are dropped; anything else is passed on for the API to reject with a message. */
function parseMarks(text: string): number[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);
}
```

Add to the `payload` object in `onSubmit`:

```ts
        alert_thresholds: parseMarks(form.alert_thresholds),
        cycle_alert_thresholds: parseMarks(form.cycle_alert_thresholds),
        cycle_pace_alert: form.cycle_pace_alert,
```

Inside the `Section title={d.settings.alertsSection}` block, after the language `<div className="mt-4 sm:max-w-sm">...</div>`, add:

```tsx
        <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:max-w-lg">
          <div>
            <label htmlFor="alert_thresholds" className={labelClass}>
              {d.settings.alertThresholds}
            </label>
            <input
              id="alert_thresholds"
              type="text"
              dir="ltr"
              inputMode="numeric"
              value={form.alert_thresholds}
              onChange={(e) => update("alert_thresholds", e.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="50, 80, 100"
            />
            <p className={hintClass}>{d.settings.alertThresholdsHint}</p>
          </div>
          <div>
            <label htmlFor="cycle_alert_thresholds" className={labelClass}>
              {d.settings.cycleAlertThresholds}
            </label>
            <input
              id="cycle_alert_thresholds"
              type="text"
              dir="ltr"
              inputMode="numeric"
              value={form.cycle_alert_thresholds}
              onChange={(e) => update("cycle_alert_thresholds", e.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="80, 100"
            />
            <p className={hintClass}>{d.settings.cycleAlertThresholdsHint}</p>
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={form.cycle_pace_alert}
            onChange={(e) => update("cycle_pace_alert", e.target.checked)}
            className="size-4 rounded border-border"
          />
          <span className="text-sm">
            {d.settings.cyclePaceAlert}
            <span className="block text-xs text-muted">{d.settings.cyclePaceAlertHint}</span>
          </span>
        </label>
```

- [ ] **Step 6: Verify in the browser**

Run `pnpm dev`, open `/en/settings`, set the daily marks to `60, 100`, save, reload: the field shows `60, 100`. Set them to `80, 50`, save: the toast shows the "ascending" message and nothing is saved. Then `curl -s -b <cookie> http://localhost:3000/api/settings` shows `"alert_thresholds":[60,100]`.

- [ ] **Step 7: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green (the dictionary parity test in particular).

---

### Task 4: Alert log and dispatcher

**Files:**
- Create: `lib/alerts/log.ts`
- Create: `lib/alerts/dispatch.ts`
- Modify: `lib/email.ts` (add `sendRendered`, route `sendAlertEmail` through it, delete `sendQuotaAlert`)

**Interfaces:**
- Consumes: `RenderedEmail` from `lib/email-template.ts`.
- Produces (exact, used by plan 02):
  - `type AlertKind = "daily_threshold" | "daily_exceeded" | "cycle_threshold" | "cycle_pace" | "link_stale" | "link_recovered" | "digest"`
  - `type AlertStatus = "sent" | "failed" | "skipped"`
  - `interface AlertEntry { kind: AlertKind; level: number | null; scopeKey: string; channel?: "email"; recipient: string | null; subject: string; status: AlertStatus; error?: string | null; payload?: Record<string, unknown> | null }`
  - `interface AlertLogRow { id: number; kind: AlertKind; level: number | null; scope_key: string; channel: string; recipient: string | null; subject: string; status: AlertStatus; error: string | null; payload: Record<string, unknown> | null; created_at: Date }`
  - `recordAlert(entry: AlertEntry): Promise<AlertLogRow>`
  - `listAlerts(limit: number, beforeId?: number | null): Promise<AlertLogRow[]>`
  - `latestAlert(kind: AlertKind, scopeKey?: string): Promise<AlertLogRow | null>`
  - `interface DispatchInput { kind: AlertKind; level: number | null; scopeKey: string; to: string | null; email: RenderedEmail; payload?: Record<string, unknown> | null }`
  - `interface DispatchResult { status: AlertStatus; row: AlertLogRow }`
  - `dispatchAlert(input: DispatchInput): Promise<DispatchResult>`
  - `sendRendered(to: string, email: RenderedEmail): Promise<string>` in `lib/email.ts`

- [ ] **Step 1: Check nothing uses `sendQuotaAlert`**

Run: `grep -rn "sendQuotaAlert\|QuotaAlertInput" app components lib --include=*.ts --include=*.tsx`
Expected: only the definition in `lib/email.ts` (lines around 51 and 62) and its mention in a comment. If any other file imports it, stop and leave it in place; otherwise delete it in Step 2.

- [ ] **Step 2: `sendRendered` in `lib/email.ts`**

Delete the `QuotaAlertInput` interface and the whole `sendQuotaAlert` function. Replace `sendAlertEmail` and its comment with:

```ts
/**
 * Send an already-rendered message. Every alert goes through here, so the
 * dispatcher can record exactly the subject that went out.
 */
export function sendRendered(to: string, email: RenderedEmail): Promise<string> {
  return send(to, email.subject, email.text, email.html);
}

/**
 * The real over-quota alert and the settings page's test send share this;
 * `report.kind` tells them apart, which is why the test mail is a true preview
 * rather than a separate template that can drift out of step.
 */
export function sendAlertEmail(to: string, report: AlertReport): Promise<string> {
  return sendRendered(to, renderAlertEmail(report));
}
```

Change the import line to `import { renderAlertEmail, type AlertReport, type RenderedEmail } from "@/lib/email-template";`. Remove the now-unused `formatBytes` import if `lint` reports it.

- [ ] **Step 3: The log module**

```ts
// lib/alerts/log.ts
import { db } from "@/lib/db";

/**
 * One row per alert the application decided to send, whether or not the send
 * worked. The history page reads this; the checks that decide whether to send
 * again read their own state (daily_windows, cycle_alerts) rather than this
 * table, so a failed insert here can never suppress a real alert.
 */

export type AlertKind =
  | "daily_threshold"
  | "daily_exceeded"
  | "cycle_threshold"
  | "cycle_pace"
  | "link_stale"
  | "link_recovered"
  | "digest";

export const ALERT_KINDS: readonly AlertKind[] = [
  "daily_threshold",
  "daily_exceeded",
  "cycle_threshold",
  "cycle_pace",
  "link_stale",
  "link_recovered",
  "digest",
];

export type AlertStatus = "sent" | "failed" | "skipped";

export interface AlertEntry {
  kind: AlertKind;
  level: number | null;
  /** What the alert is about: a local date, a cycle start date, "link", or "digest:<date>". */
  scopeKey: string;
  channel?: "email";
  recipient: string | null;
  subject: string;
  status: AlertStatus;
  error?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface AlertLogRow {
  id: number;
  kind: AlertKind;
  level: number | null;
  scope_key: string;
  channel: string;
  recipient: string | null;
  subject: string;
  status: AlertStatus;
  error: string | null;
  payload: Record<string, unknown> | null;
  created_at: Date;
}

const COLS = "id, kind, level, scope_key, channel, recipient, subject, status, error, payload, created_at";

export function recordAlert(entry: AlertEntry): Promise<AlertLogRow> {
  return db.one<AlertLogRow>(
    `INSERT INTO alerts (kind, level, scope_key, channel, recipient, subject, status, error, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING ${COLS}`,
    [
      entry.kind,
      entry.level,
      entry.scopeKey,
      entry.channel ?? "email",
      entry.recipient,
      entry.subject,
      entry.status,
      entry.error ?? null,
      entry.payload ? JSON.stringify(entry.payload) : null,
    ],
  );
}

/** Newest first. `beforeId` pages backwards: rows with a smaller id than it. */
export function listAlerts(limit: number, beforeId: number | null = null): Promise<AlertLogRow[]> {
  return db.any<AlertLogRow>(
    `SELECT ${COLS} FROM alerts
     WHERE ($2::int IS NULL OR id < $2)
     ORDER BY id DESC
     LIMIT $1`,
    [limit, beforeId],
  );
}

export function latestAlert(kind: AlertKind, scopeKey?: string): Promise<AlertLogRow | null> {
  return db.oneOrNone<AlertLogRow>(
    `SELECT ${COLS} FROM alerts
     WHERE kind = $1 AND ($2::text IS NULL OR scope_key = $2)
     ORDER BY id DESC
     LIMIT 1`,
    [kind, scopeKey ?? null],
  );
}
```

- [ ] **Step 4: The dispatcher**

```ts
// lib/alerts/dispatch.ts
import { recordAlert, type AlertKind, type AlertLogRow, type AlertStatus } from "@/lib/alerts/log";
import { sendRendered } from "@/lib/email";
import type { RenderedEmail } from "@/lib/email-template";

export interface DispatchInput {
  kind: AlertKind;
  level: number | null;
  scopeKey: string;
  /** Null when no address is configured: recorded as skipped, nothing sent. */
  to: string | null;
  email: RenderedEmail;
  payload?: Record<string, unknown> | null;
}

export interface DispatchResult {
  status: AlertStatus;
  row: AlertLogRow;
}

/**
 * Send one message and record the outcome. A send failure is not an exception
 * here: it is the row's status, so the caller can release whatever claim it
 * made and the history page can show what went wrong. Only a failure to write
 * the log row itself throws.
 */
export async function dispatchAlert(input: DispatchInput): Promise<DispatchResult> {
  const base = {
    kind: input.kind,
    level: input.level,
    scopeKey: input.scopeKey,
    recipient: input.to,
    subject: input.email.subject,
    payload: input.payload ?? null,
  };

  if (!input.to) {
    console.warn(`[alerts] ${input.kind} for ${input.scopeKey} skipped: no alert email is set`);
    const row = await recordAlert({ ...base, status: "skipped", error: "no recipient configured" });
    return { status: "skipped", row };
  }

  try {
    const id = await sendRendered(input.to, input.email);
    const row = await recordAlert({ ...base, status: "sent", payload: { ...base.payload, provider_id: id } });
    return { status: "sent", row };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[alerts] ${input.kind} for ${input.scopeKey} failed: ${message}`);
    const row = await recordAlert({ ...base, status: "failed", error: message.slice(0, 1000) });
    return { status: "failed", row };
  }
}
```

- [ ] **Step 5: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green. `tsc` proves nothing else imported `sendQuotaAlert`.

---

### Task 5: Threshold wording in the alert email

**Files:**
- Modify: `lib/email-template.ts` (AlertReport, subjectLine, renderText, renderHtml)
- Modify: `lib/email-report.ts` (AlertReportInput, buildAlertReport, minimalAlertReport, sampleAlertReport)
- Modify: `app/api/test-email/route.ts` (liveTestReport passes `threshold: null`)
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts` (`emailAlert` keys)
- Test: `lib/email-template.test.ts`

**Interfaces:**
- Produces: `AlertReport.threshold: number | null` (the mark that fired; null for a test, a digest, or the plain exceeded mail); `AlertReportInput.threshold?: number | null`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/email-template.test.ts` inside the top-level `describe`, and add `threshold: null,` to the `report()` fixture right after `app_url: null,`:

```ts
  describe("threshold marks", () => {
    const at80 = () =>
      report({
        threshold: 80,
        today: {
          used_bytes: 8.2e9,
          quota_bytes: 10e9,
          percent: 82,
          over_bytes: 0,
          tx_bytes: 1.1e9,
          rx_bytes: 7.1e9,
          peak_bytes_per_second: 20e6,
          avg_bytes_per_second: 1.2e6,
          peak_hour: 19,
          peak_hour_bytes: 2.1e9,
        },
      });

    test("subject names the mark, not a breach", () => {
      expect(subjectLine(at80())).toBe("Internet quota at 80%: 8.20 GB of 10.00 GB on 2026-09-11");
    });

    test("intro and footer speak of a warning, and promise the next mark", () => {
      const { text, html } = renderAlertEmail(at80());
      expect(text).toContain("Your home internet usage has reached 80% of the daily quota.");
      expect(text).toContain("You will be told again at the next mark.");
      expect(html).toContain("Quota at 80%");
      expect(text).not.toContain("This is the only alert you will receive for today.");
    });

    test("a mark of 100 reads as the exceeded alert", () => {
      const { text } = renderAlertEmail(report({ threshold: 100 }));
      expect(subjectLine(report({ threshold: 100 }))).toContain("Internet quota exceeded");
      expect(text).toContain("This is the only alert you will receive for today.");
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run lib/email-template.test.ts`
Expected: FAIL on the three new tests (subject reads "Internet quota report ..."); also a type error on `threshold` until Step 3.

- [ ] **Step 3: Dictionary keys**

`en.ts`, inside `emailAlert` after `subjectReport`:

```ts
    subjectThreshold: "Internet quota at {percent}: {used} of {quota} on {date}",
```

after `introReport`:

```ts
    introThreshold: "Your home internet usage has reached {percent} of the daily quota.",
```

after `alertFooter`:

```ts
    thresholdFooter: "You will be told again at the next mark.",
```

after `eyebrowReport`:

```ts
    eyebrowThreshold: "Quota at {percent}",
```

`ar.ts`, same positions:

```ts
    subjectThreshold: "حصة الإنترنت عند {percent}: {used} من أصل {quota} بتاريخ {date}",
    introThreshold: "بلغ استهلاك الإنترنت المنزلي {percent} من الحصة اليومية.",
    thresholdFooter: "ستصلك رسالة أخرى عند العلامة التالية.",
    eyebrowThreshold: "الحصة عند {percent}",
```

- [ ] **Step 4: Thread `threshold` through the report**

In `lib/email-template.ts`, add to `AlertReport` after `app_url`:

```ts
  /** The percent mark this mail announces, when it is a threshold warning below 100; null otherwise. */
  threshold: number | null;
```

Add one helper above `subjectLine`:

```ts
/** A warning at a mark below the quota, as opposed to a breach or a plain report. */
function isWarning(report: AlertReport): boolean {
  return report.threshold !== null && report.threshold < 100 && report.today.used_bytes <= report.today.quota_bytes;
}
```

Rewrite `subjectLine`:

```ts
export function subjectLine(report: AlertReport): string {
  const st = styleFor(report.locale);
  const { today } = report;
  const over = today.used_bytes > today.quota_bytes;
  const prefix = report.kind === "test" ? st.t.testPrefix : "";
  const template = over ? st.t.subjectExceeded : isWarning(report) ? st.t.subjectThreshold : st.t.subjectReport;
  return (
    prefix +
    fill(template, {
      used: formatBytes(today.used_bytes),
      quota: formatBytes(today.quota_bytes),
      // The mark is what the reader is being told about; the exact figure follows in the body.
      percent: isWarning(report) ? `${report.threshold}%` : pct(today.percent),
      date: report.date,
    })
  );
}
```

In `renderText`, replace the first pushed line `today.used_bytes > today.quota_bytes ? t.introExceeded : t.introReport,` with:

```ts
    today.used_bytes > today.quota_bytes
      ? t.introExceeded
      : isWarning(report)
        ? fill(t.introThreshold, { percent: `${report.threshold}%` })
        : t.introReport,
```

and replace `lines.push(report.kind === "test" ? t.testFooter : t.alertFooter);` with:

```ts
  lines.push(report.kind === "test" ? t.testFooter : isWarning(report) ? t.thresholdFooter : t.alertFooter);
```

In `renderHtml`, replace `eyebrow(st, over ? t.eyebrowExceeded : t.eyebrowReport, headlineTone, headlineTone)` with:

```ts
        eyebrow(
          st,
          over ? t.eyebrowExceeded : isWarning(report) ? fill(t.eyebrowThreshold, { percent: `${report.threshold}%` }) : t.eyebrowReport,
          headlineTone,
          headlineTone,
        )
```

and `const footerNote = report.kind === "test" ? t.footerTest : t.alertFooter;` with:

```ts
  const footerNote = report.kind === "test" ? t.footerTest : isWarning(report) ? t.thresholdFooter : t.alertFooter;
```

In `lib/email-report.ts`:
- `AlertReportInput`: add `threshold?: number | null;` after `quotaBytes: number;`.
- `buildAlertReport` return object: add `threshold: input.threshold ?? null,` after `app_url: appUrl(),`.
- `minimalAlertReport` return object: add `threshold: input.threshold ?? null,` after `app_url: appUrl(),`.
- `sampleAlertReport` return object: add `threshold: null,` after `app_url: appUrl(),`.

In `app/api/test-email/route.ts`, `liveTestReport` passes `threshold: null,` after `quotaBytes: today.quota_bytes,`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run lib/email-template.test.ts`
Expected: PASS, including the existing Arabic cases.

- [ ] **Step 6: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

---

### Task 6: Daily thresholds in `recordReading`

**Files:**
- Modify: `lib/usage.ts` (`DailyWindow` gains `notified_level`; `getWindowUsage` selects it; `TodayUsage` gains `notified_level`)
- Modify: `lib/readings.ts` (alert section of `recordReading`, `RecordedResult.quota`)

**Interfaces:**
- Consumes: `nextThreshold` (Task 2), `dispatchAlert` (Task 4), `renderAlertEmail`, `buildAlertReport`/`minimalAlertReport` with `threshold` (Task 5), `settings.alert_thresholds` (Task 3).
- Produces: `RecordedResult.quota.notified_level: number`; `DailyWindow.notified_level: number`; `TodayUsage.notified_level: number`.

- [ ] **Step 1: The window row carries its level**

In `lib/usage.ts`:

```ts
export interface DailyWindow {
  id: number;
  window_date: string;
  baseline_bytes: number;
  baseline_recorded_at: Date;
  notified: boolean;
  /** Highest alert mark (percent) already mailed for this day; 0 when none. */
  notified_level: number;
}
```

In `getWindowUsage`, change the `w` CTE's column list to `SELECT id, window_date, baseline_bytes, baseline_recorded_at, notified, notified_level`.

In `TodayUsage` add `notified_level: number;` after `notified: boolean;`, and in `getTodayUsage` add `notified_level: window?.notified_level ?? 0,` after `notified: window?.notified ?? false,`.

- [ ] **Step 2: Rewrite the alert section of `recordReading`**

In `lib/readings.ts`, replace the imports of `sendAlertEmail` with:

```ts
import { dispatchAlert } from "@/lib/alerts/dispatch";
import { nextThreshold } from "@/lib/alerts/thresholds";
import { renderAlertEmail } from "@/lib/email-template";
```

(keep `buildAlertReport, minimalAlertReport` from `@/lib/email-report`). Add `notified_level: number;` to `RecordedResult.quota` after `already_notified: boolean;`.

Replace everything from `const quota = quotaBytes(settings.quota_gb);` down to the closing `return { ...base, quota: {...} };` with:

```ts
  const quota = quotaBytes(settings.quota_gb);
  const exceeded = used > quota;
  const percent = quota > 0 ? (used / quota) * 100 : 0;

  // One mail per mark per day. The mark is claimed with a conditional update
  // before anything is sent, so two readings arriving at once cannot both send
  // it. A failed send releases the claim, and the next reading tries again.
  // A missing address keeps the claim: the row in `alerts` says it was skipped,
  // and there is no point re-deciding that on every push for the rest of the day.
  let alertSent = false;
  let notifiedLevel = window!.notified_level;
  const level = nextThreshold(percent, notifiedLevel, settings.alert_thresholds);
  if (level !== null) {
    const claimed = await db.oneOrNone<{ id: number }>(
      `UPDATE daily_windows SET notified_level = $2, notified = ($2 >= 100)
       WHERE id = $1 AND notified_level < $2 RETURNING id`,
      [window!.id, level],
    );
    if (claimed) {
      // The extra aggregates run once per mark, never on the pushes either side
      // of it. If any of them fail the mail still goes out with the headline.
      const figures = {
        settings,
        kind: "alert" as const,
        date: local.date,
        usedBytes: used,
        quotaBytes: quota,
        threshold: level,
        now,
      };
      const report = await buildAlertReport(figures).catch((err) => {
        console.warn("[readings] could not build the full alert report", err);
        return minimalAlertReport(figures);
      });
      const result = await dispatchAlert({
        kind: level >= 100 ? "daily_exceeded" : "daily_threshold",
        level,
        scopeKey: local.date,
        to: settings.alert_email_to,
        email: renderAlertEmail(report),
        payload: { used_bytes: used, quota_bytes: quota, percent: Math.round(percent * 10) / 10 },
      });
      if (result.status === "failed") {
        await db.none(
          `UPDATE daily_windows SET notified_level = $2, notified = ($2 >= 100) WHERE id = $1`,
          [window!.id, notifiedLevel],
        );
      } else {
        notifiedLevel = level;
        alertSent = result.status === "sent";
      }
    }
  }

  return {
    ...base,
    quota: {
      baseline_bytes: window!.baseline_bytes,
      baseline_created: baselineCreated,
      used_since_baseline: used,
      quota_bytes: quota,
      exceeded,
      alert_sent: alertSent,
      already_notified: notifiedLevel >= 100,
      notified_level: notifiedLevel,
    },
  };
```

Delete the now-unused import of `sendAlertEmail` from `@/lib/email` (lint will flag it if left).

- [ ] **Step 3: Verify against the running app**

With `pnpm dev` running and a daily quota set low enough to cross a mark (for instance `quota_gb` = 0.01 on `/settings`), post one reading as the router would:

```bash
curl -s -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"iface":"pppoe-out1","tx_bytes":50000000,"rx_bytes":50000000,"running":true}'
```

Expected: the JSON answer has `quota.notified_level` of 100 (or the highest mark reached) and `quota.alert_sent` true; `psql -c "SELECT kind, level, scope_key, status FROM alerts ORDER BY id DESC LIMIT 3"` shows the row. Post again: `notified_level` unchanged, no new row. Restore the quota afterwards.

- [ ] **Step 4: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

---

### Task 7: Pace rule and the cycle email template

**Files:**
- Create: `lib/alerts/pace.ts`, `lib/alerts/pace.test.ts`
- Create: `lib/email-cycle-template.ts`, `lib/email-cycle-template.test.ts`
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts` (new `emailCycle` section)

**Interfaces:**
- Consumes: `CycleUsage` from `lib/stats.ts`.
- Produces:
  - `paceCrossesCap(cycle: Pick<CycleUsage, "projected_bytes" | "cap_bytes" | "days_elapsed" | "over">): boolean`
  - `interface CycleReport { kind: "threshold" | "pace"; locale: Locale; generated_at: string; timezone: string; threshold: number | null; app_url: string | null; cycle: { start: string; end: string; used_bytes: number; cap_bytes: number; percent: number; projected_bytes: number; projected_percent: number; days_elapsed: number; days_total: number; days_remaining: number; daily_budget_bytes: number; daily_average_bytes: number; over: boolean } }` (start and end are local dates, YYYY-MM-DD)
  - `renderCycleEmail(report: CycleReport): RenderedEmail`
  - `cycleSubject(report: CycleReport): string`

- [ ] **Step 1: Failing tests for the pace rule**

```ts
// lib/alerts/pace.test.ts
import { describe, expect, test } from "vitest";
import { paceCrossesCap } from "@/lib/alerts/pace";

const base = { projected_bytes: 650e9, cap_bytes: 600e9, days_elapsed: 10, over: false };

describe("paceCrossesCap", () => {
  test("fires when the projection exceeds the cap after the third day", () => {
    expect(paceCrossesCap(base)).toBe(true);
  });

  test("stays quiet for the first three days, when one heavy day skews the projection", () => {
    expect(paceCrossesCap({ ...base, days_elapsed: 2 })).toBe(false);
    expect(paceCrossesCap({ ...base, days_elapsed: 3 })).toBe(true);
  });

  test("stays quiet when the projection is within the cap", () => {
    expect(paceCrossesCap({ ...base, projected_bytes: 600e9 })).toBe(false);
  });

  test("leaves an already-exceeded cap to the threshold alert", () => {
    expect(paceCrossesCap({ ...base, over: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Run: `pnpm exec vitest run lib/alerts/pace.test.ts` → FAIL, module not found.

```ts
// lib/alerts/pace.ts
import type { CycleUsage } from "@/lib/stats";

/** Days of a cycle to ignore before trusting the projection. */
const SETTLE_DAYS = 3;

/**
 * Whether the cycle is on course to run out of cap. Once the cap is actually
 * exceeded the 100 % threshold mail covers it, so this stays false then.
 */
export function paceCrossesCap(
  cycle: Pick<CycleUsage, "projected_bytes" | "cap_bytes" | "days_elapsed" | "over">,
): boolean {
  if (cycle.over) return false;
  if (cycle.days_elapsed < SETTLE_DAYS) return false;
  return cycle.projected_bytes > cycle.cap_bytes;
}
```

Run again → PASS, 4 tests.

- [ ] **Step 3: Dictionary section `emailCycle`**

`en.ts`, add a new top-level section after `emailAlert`:

```ts
  /** The monthly-cap mails: a threshold mark reached, or the projection crossing the cap. */
  emailCycle: {
    subjectThreshold: "Monthly cap at {percent}: {used} of {cap} used",
    subjectOver: "Monthly cap exceeded: {used} of {cap} used",
    subjectPace: "On course to exceed the monthly cap: {projected} projected of {cap}",
    introThreshold: "Usage this billing cycle has reached {percent} of the monthly cap.",
    introOver: "Usage this billing cycle has exceeded the monthly cap.",
    introPace:
      "At the current pace this billing cycle will end at {projected}, which is over the {cap} cap.",
    cycleSpan: "Cycle",
    cycleSpanValue: "{start} to {end} ({timezone})",
    used: "Used",
    usedValue: "{used} of {cap} ({percent})",
    projected: "Projected at cycle end",
    projectedValue: "{projected} ({percent} of cap)",
    progress: "Progress",
    progressValue: "day {elapsed} of {total}, {remaining} left",
    dailyAverage: "Daily average so far",
    budget: "Budget per remaining day",
    footerThreshold: "You will be told again at the next mark, and once more if the cap is exceeded.",
    footerPace: "This projection warning is sent once per cycle.",
    dashboardLine: "Dashboard: {url}",
    openDashboard: "Open the dashboard",
  },
```

`ar.ts`, same position:

```ts
  emailCycle: {
    subjectThreshold: "السقف الشهري عند {percent}: استُهلك {used} من أصل {cap}",
    subjectOver: "تم تجاوز السقف الشهري: استُهلك {used} من أصل {cap}",
    subjectPace: "في طريقك لتجاوز السقف الشهري: المتوقّع {projected} من أصل {cap}",
    introThreshold: "بلغ الاستهلاك في دورة الفوترة هذه {percent} من السقف الشهري.",
    introOver: "تجاوز الاستهلاك في دورة الفوترة هذه السقف الشهري.",
    introPace:
      "بالوتيرة الحالية ستنتهي دورة الفوترة هذه عند {projected}، وهو ما يتجاوز السقف البالغ {cap}.",
    cycleSpan: "الدورة",
    cycleSpanValue: "من {start} إلى {end} ({timezone})",
    used: "المستهلك",
    usedValue: "{used} من أصل {cap} ({percent})",
    projected: "المتوقّع في نهاية الدورة",
    projectedValue: "{projected} ({percent} من السقف)",
    progress: "التقدّم",
    progressValue: "اليوم {elapsed} من {total}، بقي {remaining}",
    dailyAverage: "المتوسط اليومي حتى الآن",
    budget: "الميزانية لكل يوم متبقٍ",
    footerThreshold: "ستصلك رسالة أخرى عند العلامة التالية، ورسالة إضافية إذا تم تجاوز السقف.",
    footerPace: "يُرسل تحذير التوقّع هذا مرة واحدة في كل دورة.",
    dashboardLine: "لوحة التحكم: {url}",
    openDashboard: "افتح لوحة التحكم",
  },
```

- [ ] **Step 4: Failing tests for the template**

```ts
// lib/email-cycle-template.test.ts
import { describe, expect, test } from "vitest";
import { cycleSubject, renderCycleEmail, type CycleReport } from "@/lib/email-cycle-template";

function report(overrides: Partial<CycleReport> = {}): CycleReport {
  return {
    kind: "threshold",
    locale: "en",
    generated_at: "2026-09-20T10:00:00.000Z",
    timezone: "Asia/Beirut",
    threshold: 80,
    app_url: "https://netmonitor.example",
    cycle: {
      start: "2026-09-05",
      end: "2026-10-05",
      used_bytes: 486e9,
      cap_bytes: 600e9,
      percent: 81,
      projected_bytes: 972e9,
      projected_percent: 162,
      days_elapsed: 15,
      days_total: 30,
      days_remaining: 15,
      daily_budget_bytes: 7.6e9,
      daily_average_bytes: 32.4e9,
      over: false,
    },
    ...overrides,
  };
}

describe("cycleSubject", () => {
  test("names the mark", () => {
    expect(cycleSubject(report())).toBe("Monthly cap at 80%: 486.00 GB of 600.00 GB used");
  });

  test("says exceeded at 100", () => {
    expect(cycleSubject(report({ threshold: 100, cycle: { ...report().cycle, over: true, used_bytes: 601e9, percent: 100.2 } }))).toBe(
      "Monthly cap exceeded: 601.00 GB of 600.00 GB used",
    );
  });

  test("describes the projection for a pace warning", () => {
    expect(cycleSubject(report({ kind: "pace", threshold: null }))).toBe(
      "On course to exceed the monthly cap: 972.00 GB projected of 600.00 GB",
    );
  });
});

describe("renderCycleEmail", () => {
  test("carries the cycle figures in both bodies", () => {
    const { text, html } = renderCycleEmail(report());
    for (const body of [text, html]) {
      expect(body).toContain("486.00 GB of 600.00 GB (81%)");
      expect(body).toContain("972.00 GB (162% of cap)");
      expect(body).toContain("day 15 of 30, 15 left");
      expect(body).toContain("2026-09-05 to 2026-10-05 (Asia/Beirut)");
    }
    expect(html).toContain('href="https://netmonitor.example"');
    expect(text).toContain("Dashboard: https://netmonitor.example");
  });

  test("omits the dashboard link without an app url", () => {
    const { text, html } = renderCycleEmail(report({ app_url: null }));
    expect(html).not.toContain("<a ");
    expect(text).not.toContain("Dashboard:");
  });

  test("renders Arabic right to left with no English prose", () => {
    const { html, text } = renderCycleEmail(report({ locale: "ar" }));
    expect(html).toContain('dir="rtl"');
    expect(text).not.toContain("Monthly cap");
    expect(text).toContain("السقف الشهري");
  });

  test("escapes HTML in values", () => {
    const { html } = renderCycleEmail(report({ timezone: "<script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
```

- [ ] **Step 5: Run to verify failure, then implement**

Run: `pnpm exec vitest run lib/email-cycle-template.test.ts` → FAIL, module not found.

```ts
// lib/email-cycle-template.ts
/**
 * The monthly-cap mail, rendered. Pure, like lib/email-template.ts: a
 * CycleReport in, subject and both bodies out. Far simpler than the daily
 * alert because there is one number to tell and no chart.
 */

import type { RenderedEmail } from "@/lib/email-template";
import { formatBytes } from "@/lib/format";
import { fill, getDictionaryFor } from "@/lib/i18n";
import { DIRECTION, type Locale } from "@/lib/i18n/config";

export interface CycleReport {
  kind: "threshold" | "pace";
  locale: Locale;
  generated_at: string;
  timezone: string;
  /** The mark reached, for a threshold mail; null for a pace warning. */
  threshold: number | null;
  app_url: string | null;
  cycle: {
    /** Local dates, YYYY-MM-DD. `end` is the day the next cycle begins. */
    start: string;
    end: string;
    used_bytes: number;
    cap_bytes: number;
    percent: number;
    projected_bytes: number;
    projected_percent: number;
    days_elapsed: number;
    days_total: number;
    days_remaining: number;
    daily_budget_bytes: number;
    daily_average_bytes: number;
    over: boolean;
  };
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pct(value: number): string {
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}%`;
}

function values(report: CycleReport) {
  const c = report.cycle;
  return {
    used: formatBytes(c.used_bytes),
    cap: formatBytes(c.cap_bytes),
    percent: report.threshold !== null && !c.over ? `${report.threshold}%` : pct(c.percent),
    projected: formatBytes(c.projected_bytes),
    projectedPercent: pct(c.projected_percent),
  };
}

export function cycleSubject(report: CycleReport): string {
  const t = getDictionaryFor(report.locale).emailCycle;
  const v = values(report);
  if (report.kind === "pace") return fill(t.subjectPace, { projected: v.projected, cap: v.cap });
  return fill(report.cycle.over ? t.subjectOver : t.subjectThreshold, { percent: v.percent, used: v.used, cap: v.cap });
}

export function renderCycleEmail(report: CycleReport): RenderedEmail {
  const t = getDictionaryFor(report.locale).emailCycle;
  const c = report.cycle;
  const v = values(report);
  const dir = DIRECTION[report.locale];
  const align = dir === "rtl" ? "right" : "left";

  const intro =
    report.kind === "pace"
      ? fill(t.introPace, { projected: v.projected, cap: v.cap })
      : c.over
        ? t.introOver
        : fill(t.introThreshold, { percent: v.percent });
  const footer = report.kind === "pace" ? t.footerPace : t.footerThreshold;

  const rows: [string, string][] = [
    [t.cycleSpan, fill(t.cycleSpanValue, { start: c.start, end: c.end, timezone: report.timezone })],
    [t.used, fill(t.usedValue, { used: v.used, cap: v.cap, percent: pct(c.percent) })],
    [t.projected, fill(t.projectedValue, { projected: v.projected, percent: v.projectedPercent })],
    [t.progress, fill(t.progressValue, { elapsed: c.days_elapsed, total: c.days_total, remaining: c.days_remaining })],
    [t.dailyAverage, formatBytes(c.daily_average_bytes)],
    [t.budget, formatBytes(c.daily_budget_bytes)],
  ];

  const text = [
    intro,
    "",
    ...rows.map(([label, value]) => `  ${label.padEnd(24)}${value}`),
    "",
    footer,
    ...(report.app_url ? [fill(t.dashboardLine, { url: report.app_url })] : []),
  ].join("\n");

  const pad = "padding:6px 12px;font-size:14px";
  const table = rows
    .map(([label, value]) => `<tr><td style="${pad};color:#71717a">${esc(label)}</td><td style="${pad}">${esc(value)}</td></tr>`)
    .join("");
  const button = report.app_url
    ? `<p style="margin:16px 0 0"><a href="${esc(report.app_url)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px">${esc(t.openDashboard)}</a></p>`
    : "";
  const html = `<div dir="${dir}" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;text-align:${align}">
      <h2 style="margin:0 0 12px">${esc(cycleSubject(report))}</h2>
      <p style="margin:0 0 16px;color:#444">${esc(intro)}</p>
      <table style="border-collapse:collapse">${table}</table>
      ${button}
      <p style="margin:16px 0 0;color:#888;font-size:12px">${esc(footer)}</p>
    </div>`;

  return { subject: cycleSubject(report), text, html };
}
```

Run: `pnpm exec vitest run lib/email-cycle-template.test.ts` → PASS, 7 tests. If the Arabic "no English prose" test fails on `formatBytes` output, it will not: units are Latin in both languages and the assertion checks the phrase "Monthly cap" only.

- [ ] **Step 6: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

---

### Task 8: The cycle check, called from ingest

**Files:**
- Create: `lib/alerts/cycle.ts`
- Modify: `app/api/ingest/route.ts` (call after `recordReading`, add `cycle_check` to the response)

**Interfaces:**
- Consumes: `getCycleUsage` (`lib/stats.ts`), `cycleBounds` (`lib/billing.ts`), `localParts` (`lib/time.ts`), `nextThreshold`, `paceCrossesCap`, `renderCycleEmail`, `dispatchAlert`, settings columns from Task 3.
- Produces: `checkCycleAlerts(settings: SettingsRow, now?: Date): Promise<CycleCheck>` where `interface CycleCheck { status: "checked" | "throttled" | "failed"; sent: AlertKind[]; detail?: string }`.

- [ ] **Step 1: The module**

```ts
// lib/alerts/cycle.ts
import { dispatchAlert } from "@/lib/alerts/dispatch";
import type { AlertKind } from "@/lib/alerts/log";
import { paceCrossesCap } from "@/lib/alerts/pace";
import { nextThreshold } from "@/lib/alerts/thresholds";
import { db } from "@/lib/db";
import { renderCycleEmail, type CycleReport } from "@/lib/email-cycle-template";
import { alertLocale, type SettingsRow } from "@/lib/settings";
import { getCycleUsage, type CycleUsage } from "@/lib/stats";
import { localParts } from "@/lib/time";

/**
 * The monthly-cap alerts. Runs from the ingest path, so it is throttled: the
 * cycle total is one aggregate over the whole cycle, and thirty seconds of
 * traffic cannot move it far enough to matter. State is per process; a second
 * instance simply checks on its own clock, and the conditional updates below
 * keep the two from both mailing.
 */
const CHECK_EVERY_MS = 5 * 60_000;
let lastCheckedAt = 0;

export interface CycleCheck {
  status: "checked" | "throttled" | "failed";
  sent: AlertKind[];
  detail?: string;
}

interface CycleAlertRow {
  cycle_start: string;
  notified_level: number;
  pace_notified: boolean;
}

function appUrl(): string | null {
  const raw = process.env.APP_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

function toReport(kind: CycleReport["kind"], threshold: number | null, settings: SettingsRow, cycle: CycleUsage, now: Date): CycleReport {
  return {
    kind,
    locale: alertLocale(settings),
    generated_at: now.toISOString(),
    timezone: settings.timezone,
    threshold,
    app_url: appUrl(),
    cycle: {
      start: localParts(new Date(cycle.start), settings.timezone).date,
      end: localParts(new Date(cycle.end), settings.timezone).date,
      used_bytes: cycle.used_bytes,
      cap_bytes: cycle.cap_bytes,
      percent: cycle.percent_of_cap,
      projected_bytes: cycle.projected_bytes,
      projected_percent: cycle.projected_percent,
      days_elapsed: cycle.days_elapsed,
      days_total: cycle.days_total,
      days_remaining: cycle.days_remaining,
      daily_budget_bytes: cycle.daily_budget_bytes,
      daily_average_bytes: cycle.daily_average_bytes,
      over: cycle.over,
    },
  };
}

export async function checkCycleAlerts(settings: SettingsRow, now = new Date()): Promise<CycleCheck> {
  if (now.getTime() - lastCheckedAt < CHECK_EVERY_MS) return { status: "throttled", sent: [] };
  lastCheckedAt = now.getTime();

  const sent: AlertKind[] = [];
  try {
    const cycle = await getCycleUsage(settings.monthly_quota_gb, settings.billing_cycle_day, settings.timezone, now);
    const cycleStart = localParts(new Date(cycle.start), settings.timezone).date;

    const state = await db.one<CycleAlertRow>(
      `INSERT INTO cycle_alerts (cycle_start) VALUES ($1)
       ON CONFLICT (cycle_start) DO UPDATE SET updated_at = now()
       RETURNING cycle_start::text, notified_level, pace_notified`,
      [cycleStart],
    );

    const level = nextThreshold(cycle.percent_of_cap, state.notified_level, settings.cycle_alert_thresholds);
    if (level !== null) {
      const claimed = await db.oneOrNone(
        `UPDATE cycle_alerts SET notified_level = $2, updated_at = now()
         WHERE cycle_start = $1 AND notified_level < $2 RETURNING cycle_start`,
        [cycleStart, level],
      );
      if (claimed) {
        const result = await dispatchAlert({
          kind: "cycle_threshold",
          level,
          scopeKey: cycleStart,
          to: settings.alert_email_to,
          email: renderCycleEmail(toReport("threshold", level, settings, cycle, now)),
          payload: { used_bytes: cycle.used_bytes, cap_bytes: cycle.cap_bytes, percent: cycle.percent_of_cap },
        });
        if (result.status === "failed") {
          await db.none("UPDATE cycle_alerts SET notified_level = $2 WHERE cycle_start = $1", [cycleStart, state.notified_level]);
        } else if (result.status === "sent") {
          sent.push("cycle_threshold");
        }
      }
    }

    if (settings.cycle_pace_alert && !state.pace_notified && paceCrossesCap(cycle)) {
      const claimed = await db.oneOrNone(
        `UPDATE cycle_alerts SET pace_notified = true, updated_at = now()
         WHERE cycle_start = $1 AND pace_notified = false RETURNING cycle_start`,
        [cycleStart],
      );
      if (claimed) {
        const result = await dispatchAlert({
          kind: "cycle_pace",
          level: null,
          scopeKey: cycleStart,
          to: settings.alert_email_to,
          email: renderCycleEmail(toReport("pace", null, settings, cycle, now)),
          payload: { projected_bytes: cycle.projected_bytes, cap_bytes: cycle.cap_bytes, days_elapsed: cycle.days_elapsed },
        });
        if (result.status === "failed") {
          await db.none("UPDATE cycle_alerts SET pace_notified = false WHERE cycle_start = $1", [cycleStart]);
        } else if (result.status === "sent") {
          sent.push("cycle_pace");
        }
      }
    }

    return { status: "checked", sent };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[alerts] cycle check failed:", detail);
    return { status: "failed", sent, detail };
  }
}
```

- [ ] **Step 2: Call it from the ingest route**

In `app/api/ingest/route.ts` add `import { checkCycleAlerts } from "@/lib/alerts/cycle";`. After `const result = await recordReading(settings, wanCounters, now, null, stored);` add:

```ts
    // Never fails the push: the reading is already stored, and the check
    // reports its own outcome in the response for the router log.
    const cycleCheck = await checkCycleAlerts(settings, now);
```

and add `cycle_check: cycleCheck,` to the returned JSON object, after `router_clock_skew_seconds: clockSkewSeconds,`.

- [ ] **Step 3: Verify**

With `pnpm dev` running, set the monthly cap on `/settings` to a value below the current cycle's usage shown on the dashboard (for instance 1 GB), then post a reading as in Task 6 Step 3. Expected: the response has `cycle_check.status` "checked" and `cycle_check.sent` containing `"cycle_threshold"`; `alerts` has a `cycle_threshold` row with `level` 100 and `scope_key` equal to the cycle start date. Post again within five minutes: `cycle_check.status` is "throttled". Restore the cap.

- [ ] **Step 4: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

---

### Task 9: Alert history API and page

**Files:**
- Create: `app/api/alerts/route.ts`
- Create: `app/[lang]/(app)/alerts/page.tsx`
- Create: `components/AlertsTable.tsx`
- Modify: `components/Nav.tsx` (LINKS)
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts` (`nav.alerts`, new `alerts` section, `errors.limitRange` already exists)

**Interfaces:**
- Consumes: `listAlerts`, `AlertLogRow`, `ALERT_KINDS` (Task 4); `getI18n`, `Formatters.stamp`.
- Produces: `GET /api/alerts?limit=<1..500>&before=<id>` → `{ alerts: PublicAlert[] }` where `interface PublicAlert extends Omit<AlertLogRow, "created_at"> { created_at: string }`.

- [ ] **Step 1: Dictionary keys**

`en.ts`: in `nav` add `alerts: "Alerts",`. New top-level section after `export`:

```ts
  alerts: {
    title: "Alerts",
    subtitle: "Every alert the monitor decided to send, newest first. Times in {timezone}.",
    empty: "No alerts yet. The first one appears when usage reaches a mark set on the Settings page.",
    columns: {
      when: "When",
      kind: "Alert",
      level: "Mark",
      scope: "About",
      recipient: "Sent to",
      status: "Status",
    },
    kinds: {
      daily_threshold: "Daily quota mark",
      daily_exceeded: "Daily quota exceeded",
      cycle_threshold: "Monthly cap mark",
      cycle_pace: "Cap projection warning",
      link_stale: "Router silent",
      link_recovered: "Router back",
      digest: "Digest",
    },
    statuses: {
      sent: "sent",
      failed: "failed",
      skipped: "skipped",
    },
    skippedReason: "no address was configured",
    showing: "Showing the last {count} alerts.",
  },
```

`ar.ts`: in `nav` add `alerts: "التنبيهات",`. New section after `export`:

```ts
  alerts: {
    title: "التنبيهات",
    subtitle: "كل تنبيه قرّر المراقب إرساله، الأحدث أولاً. الأوقات بتوقيت {timezone}.",
    empty: "لا تنبيهات بعد. يظهر الأول عندما يبلغ الاستهلاك علامة محددة في صفحة الإعدادات.",
    columns: {
      when: "الوقت",
      kind: "التنبيه",
      level: "العلامة",
      scope: "بخصوص",
      recipient: "أُرسل إلى",
      status: "الحالة",
    },
    kinds: {
      daily_threshold: "علامة الحصة اليومية",
      daily_exceeded: "تجاوز الحصة اليومية",
      cycle_threshold: "علامة السقف الشهري",
      cycle_pace: "تحذير توقّع السقف",
      link_stale: "الراوتر صامت",
      link_recovered: "عاد الراوتر",
      digest: "الملخّص",
    },
    statuses: {
      sent: "أُرسل",
      failed: "فشل",
      skipped: "تم التخطي",
    },
    skippedReason: "لم يكن هناك عنوان محدد",
    showing: "عرض آخر {count} تنبيهاً.",
  },
```

- [ ] **Step 2: The API route**

```ts
// app/api/alerts/route.ts
import { NextResponse } from "next/server";
import { badRequest, errorResponse, rejectUnauthenticated } from "@/lib/api";
import { listAlerts, type AlertLogRow } from "@/lib/alerts/log";
import { fill } from "@/lib/i18n";
import { dictionaryFromRequest } from "@/lib/i18n/request";

const MAX_LIMIT = 500;

export interface PublicAlert extends Omit<AlertLogRow, "created_at"> {
  created_at: string;
}

export function toPublicAlert(row: AlertLogRow): PublicAlert {
  return { ...row, created_at: row.created_at.toISOString() };
}

export async function GET(request: Request) {
  const d = dictionaryFromRequest(request);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const limitRaw = params.get("limit") ?? "100";
  const beforeRaw = params.get("before");
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return badRequest(fill(d.errors.limitRange, { max: MAX_LIMIT }));
  }
  const before = beforeRaw === null ? null : Number(beforeRaw);
  if (before !== null && (!Number.isInteger(before) || before < 1)) {
    return badRequest(d.errors.validationFailed);
  }

  try {
    const rows = await listAlerts(limit, before);
    return NextResponse.json({ alerts: rows.map(toPublicAlert) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, d);
  }
}
```

- [ ] **Step 3: The table component**

```tsx
// components/AlertsTable.tsx
import type { PublicAlert } from "@/app/api/alerts/route";
import { getI18n } from "@/lib/i18n/server";

const STATUS_CLASS: Record<PublicAlert["status"], string> = {
  sent: "text-green-700 dark:text-status-good",
  failed: "text-status-critical",
  skipped: "text-amber-700 dark:text-status-warning",
};

export async function AlertsTable({ alerts, timezone }: { alerts: PublicAlert[]; timezone: string }) {
  const { d, f } = await getI18n();
  const c = d.alerts.columns;

  if (alerts.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">{d.alerts.empty}</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-border">
            <th className="px-4 py-2 text-start font-medium">{c.when}</th>
            <th className="px-4 py-2 text-start font-medium">{c.kind}</th>
            <th className="px-4 py-2 text-start font-medium">{c.level}</th>
            <th className="px-4 py-2 text-start font-medium">{c.scope}</th>
            <th className="px-4 py-2 text-start font-medium">{c.recipient}</th>
            <th className="px-4 py-2 text-start font-medium">{c.status}</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id} className="border-b border-border last:border-0">
              <td className="whitespace-nowrap px-4 py-2 tabular-nums">{f.stamp(a.created_at, timezone)}</td>
              <td className="px-4 py-2">{d.alerts.kinds[a.kind]}</td>
              <td className="px-4 py-2 tabular-nums">{a.level === null ? d.common.empty : `${a.level}%`}</td>
              <td className="px-4 py-2 font-mono text-xs" dir="ltr">{a.scope_key}</td>
              <td className="px-4 py-2 text-xs" dir="ltr">{a.recipient ?? d.common.empty}</td>
              <td className={`px-4 py-2 ${STATUS_CLASS[a.status]}`} title={a.error ?? undefined}>
                {d.alerts.statuses[a.status]}
                {a.status === "skipped" && (
                  <span className="block text-xs font-normal text-muted">{d.alerts.skippedReason}</span>
                )}
                {a.status === "failed" && a.error && (
                  <span className="block max-w-xs truncate text-xs font-normal text-muted">{a.error}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: The page**

```tsx
// app/[lang]/(app)/alerts/page.tsx
import type { Metadata } from "next";
import { connection } from "next/server";
import { toPublicAlert } from "@/app/api/alerts/route";
import { AlertsTable } from "@/components/AlertsTable";
import { AutoRefresh } from "@/components/AutoRefresh";
import { listAlerts } from "@/lib/alerts/log";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";

const LIMIT = 100;

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.alerts.title} - ${d.meta.appName}` };
}

export default async function AlertsPage() {
  await connection();
  const { d } = await getI18n();
  const [settings, rows] = await Promise.all([getSettings(), listAlerts(LIMIT)]);
  const alerts = rows.map(toPublicAlert);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{d.alerts.title}</h1>
          <p className="text-sm text-muted">{fill(d.alerts.subtitle, { timezone: settings.timezone })}</p>
        </div>
        <AutoRefresh seconds={30} />
      </div>

      <AlertsTable alerts={alerts} timezone={settings.timezone} />

      {alerts.length === LIMIT && <p className="text-xs text-muted">{fill(d.alerts.showing, { count: LIMIT })}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Navigation**

In `components/Nav.tsx` insert into `LINKS` after the sessions entry:

```ts
  { path: "/alerts", label: (d: Dictionary) => d.nav.alerts },
```

- [ ] **Step 6: Verify**

Open `/en/alerts` and `/ar/alerts` with `pnpm dev`: the rows from Tasks 6 and 8 show with a localised kind, the mark, the date, the address and a coloured status. `curl -s -b <cookie> "http://localhost:3000/api/alerts?limit=2"` returns two rows; `?limit=0` returns 400.

- [ ] **Step 7: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

---

### Task 10: README

**Files:**
- Modify: `README.md` (replace the paragraph starting "Alongside the daily window quota there is a monthly cap" and add an "Alerts" subsection under "How it works")

- [ ] **Step 1: Rewrite the cap paragraph and add the section**

Replace the paragraph beginning `Alongside the daily window quota there is a monthly cap` with:

```markdown
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
cannot both send it, and a failed send releases the claim so the next reading retries.
```

- [ ] **Step 2: Final check of the whole plan**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit && pnpm build`
Expected: all green; the build lists `/[lang]/alerts` and `/api/alerts`.

---

## Self-review notes

- Spec coverage: contract 1 (Task 1, 4), contract 2 (Task 4), contract 3 rows for this plan (Task 1, 3), contract 4 (Task 1, 6, 8), contract 9 modules `thresholds.ts` and `pace.ts` (Task 2, 7). The Alerts page and README were added by the directive (Tasks 9, 10).
- Names used by plan 02: `dispatchAlert`, `DispatchInput`, `DispatchResult`, `recordAlert`, `listAlerts`, `latestAlert`, `AlertKind`, `AlertLogRow`, `AlertStatus`, `sendRendered`, `AlertReport.threshold`, `AlertReportInput.threshold`. All defined above with the roadmap's signatures.
- `notified` on `daily_windows` is still written (as `notified_level >= 100`), so `getComplianceDays` and the stats page keep working unchanged.
