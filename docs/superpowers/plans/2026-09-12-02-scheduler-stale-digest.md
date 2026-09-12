# Scheduler Tick, Stale-Router Alert and Scheduled Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app a heartbeat it does not owe to the router, so it can say "the router has gone quiet" and send a weekly or per-cycle summary on schedule.

**Architecture:** One authenticated endpoint, `/api/cron/tick`, runs a fixed list of jobs in sequence and records each run in `job_runs`. Every job is idempotent and decides for itself whether there is anything to do, so the endpoint can be hit every minute or once a day. Two jobs ship here: `stale` (mail when no reading has arrived for `stale_after_minutes`, mail again once readings resume) and `digest` (the existing alert report, re-labelled, on Monday mornings or the morning after the billing cycle rolls over). The decision logic is pure and unit-tested; the jobs are thin. Three interchangeable triggers call the endpoint: a Vercel cron, a GitHub Actions schedule, and a curl loop in docker-compose.

**Tech Stack:** Next.js 16 App Router Route Handlers, pg-promise, Resend through the existing `lib/email.ts`, vitest, `@vercel/config` for `vercel.ts`.

**Spec:** `docs/superpowers/plans/2026-09-12-00-roadmap.md` (contract 5 "the scheduler tick", contract 3 rows `stale_after_minutes` and `digest`, contract 9 module `lib/cron/schedule.ts`). This plan uses contracts 1 and 2 from plan 01.

## Global Constraints

- **Plan 01 (`2026-09-12-01-alert-log-and-thresholds.md`) must be executed first.** This plan imports, by these exact names, from plan 01: `lib/alerts/log.ts` (`recordAlert`, `listAlerts`, `latestAlert(kind, scopeKey?)`, `AlertKind`, `AlertLogRow`), `lib/alerts/dispatch.ts` (`dispatchAlert({ kind, level, scopeKey, to, email, payload })` returning `Promise<{ status, row }>`), `lib/email.ts` `sendRendered(to, email: RenderedEmail)`, and the fields `AlertReport.threshold: number | null` (lib/email-template.ts) and `AlertReportInput.threshold` (lib/email-report.ts). `AlertKind` already includes `"link_stale"`, `"link_recovered"` and `"digest"`.
- Next.js 16: read `node_modules/next/dist/docs/` before writing a route or page. `connection()` at the top of dynamic pages; Route Handlers export `GET`/`POST` functions taking `Request`.
- Every user-visible string goes into `lib/i18n/dictionaries/en.ts` AND `lib/i18n/dictionaries/ar.ts`. `lib/i18n.test.ts` fails on a missing Arabic key or an Arabic value identical to the English one.
- Unit tests: vitest, `lib/**/*.test.ts`, no database.
- Route Handlers use `isCronAuthorized(request)` from `lib/api.ts` for the router/scheduler bearer token, `errorResponse(err)` for failures.
- Schema changes are idempotent statements appended to the migrations section of `schema.sql`; CHECK constraints go in the `DO $$ ... $$` block.
- Settings columns need: `schema.sql`, `SettingsRow` + `PublicSettings` + `SettingsPatch` + `WRITABLE` + `loadSettings` SELECT + `toPublicSettings` in `lib/settings.ts`, the zod schema in `app/api/settings/route.ts`, `components/SettingsForm.tsx`, and `settings.fields` labels in both dictionaries.
- Public routes are listed in `PUBLIC_API` in `proxy.ts`.
- **No task commits.** The user commits manually. Each task ends when `pnpm test`, `pnpm lint` and `pnpm exec tsc --noEmit` all pass.
- Production URL is `https://netmonitor.bilalnasr.com` on Vercel; the router pushes every 30 s. Default `stale_after_minutes` is 10 (twenty missed pushes).
- Digests fire at 08:00 in `settings.timezone`. Weekly: Monday. Cycle: the first day of a new billing cycle (`settings.billing_cycle_day`).

---

## File map

| File | Responsibility | Task |
| --- | --- | --- |
| `schema.sql` | `job_runs` table, settings columns `stale_after_minutes`, `digest` | 1 |
| `lib/settings.ts`, `app/api/settings/route.ts`, `components/SettingsForm.tsx`, dictionaries | the two settings end to end | 1 |
| `lib/cron/schedule.ts` (+ test) | pure: `isStale`, `isDigestDue`, `digestDueAt` | 2 |
| `lib/cron/runs.ts` | `job_runs` read/write | 3 |
| `lib/cron/jobs.ts` | `Job`, `JobContext`, `JobResult`, `JOBS` registry | 3 |
| `lib/cron/tick.ts` | `runTick(now)`: run every job, record, never abort | 3 |
| `app/api/cron/tick/route.ts`, `proxy.ts` | the endpoint, made public | 3 |
| `lib/email-link-template.ts` (+ test), dictionaries `emailLink` | pure stale/recovered mail | 4 |
| `lib/cron/stale.ts` | the stale job | 5 |
| `lib/email-template.ts` (+ test), `lib/email-report.ts`, dictionaries `emailAlert.*Digest*` | digest wording on the existing report | 6 |
| `lib/cron/digest.ts` | the digest job | 7 |
| `components/StatusCard.tsx`, `app/[lang]/(app)/page.tsx`, dictionaries | "alert sent" line under "No contact" | 8 |
| `vercel.ts`, `.github/workflows/tick.yml`, `docker-compose.yml`, `README.md`, `.env.local.example` | triggers and docs | 9 |

---

### Task 1: Schema and the two settings

**Files:**
- Modify: `schema.sql` (migrations section, after the `language` ALTER; the `DO $$` block; the tables section)
- Modify: `lib/settings.ts`
- Modify: `app/api/settings/route.ts`
- Modify: `components/SettingsForm.tsx`
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts`

**Interfaces:**
- Produces: `SettingsRow.stale_after_minutes: number`, `SettingsRow.digest: DigestKind` where `export type DigestKind = "off" | "weekly" | "cycle"` exported from `lib/settings.ts`; same two fields on `PublicSettings` and `SettingsPatch`.

- [ ] **Step 1: Add the table and columns to `schema.sql`**

In the `-- tables ----` section, after the `password_resets` table:

```sql
-- One row per scheduled job, written by /api/cron/tick after every run. The
-- tick may be called every minute; each job reads its own state (this row,
-- the alerts log) to decide whether there is anything to do.
CREATE TABLE IF NOT EXISTS job_runs (
  job          TEXT PRIMARY KEY,
  last_run_at  TIMESTAMPTZ NOT NULL,
  last_status  TEXT NOT NULL,
  last_detail  TEXT
);
```

In the `-- migrations ----` section, after the `language` ALTER:

```sql
-- Scheduled checks (plan 02). stale_after_minutes = 0 disables the
-- "router has gone quiet" alert. digest picks the scheduled summary.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS stale_after_minutes INTEGER NOT NULL DEFAULT 10;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS digest TEXT NOT NULL DEFAULT 'weekly';
```

Inside the existing `DO $$ BEGIN ... END $$;` block, before `END`:

```sql
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_stale_after_minutes_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_stale_after_minutes_check
      CHECK (stale_after_minutes BETWEEN 0 AND 1440);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_digest_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_digest_check
      CHECK (digest IN ('off', 'weekly', 'cycle'));
  END IF;
```

- [ ] **Step 2: Apply the schema to the dev database and confirm it is idempotent**

Run twice (bash, from the project root; `DATABASE_URL` from `.env.local`):

```bash
psql "$DATABASE_URL" -f schema.sql && psql "$DATABASE_URL" -f schema.sql
```

Expected: no errors either time; `psql "$DATABASE_URL" -c "\d job_runs"` lists four columns.

- [ ] **Step 3: Plumb the columns through `lib/settings.ts`**

Add next to `SettingsRow`:

```ts
/** Which scheduled summary is sent. See lib/cron/digest.ts. */
export type DigestKind = "off" | "weekly" | "cycle";
export const DIGEST_KINDS: readonly DigestKind[] = ["off", "weekly", "cycle"];

export function isDigestKind(value: string): value is DigestKind {
  return (DIGEST_KINDS as readonly string[]).includes(value);
}
```

Add to `SettingsRow` (after `language`):

```ts
  /** Minutes without a push before the link_stale alert. 0 disables it. */
  stale_after_minutes: number;
  digest: DigestKind;
```

Add the same two lines to `PublicSettings` (with `digest: string`), add `"stale_after_minutes" | "digest"` to the `Pick` union in `SettingsPatch`, add both names to the `WRITABLE` set, add `stale_after_minutes, digest` to the SELECT column list in `loadSettings`, and in `toPublicSettings` add:

```ts
    stale_after_minutes: row.stale_after_minutes,
    digest: row.digest,
```

- [ ] **Step 4: Validate them in `app/api/settings/route.ts`**

Import `DIGEST_KINDS` from `@/lib/settings`. Inside the `z.object({...})` of `patchSchema`, after `language`:

```ts
      stale_after_minutes: z.coerce
        .number()
        .int(e.staleMinutesWhole)
        .min(0, e.staleMinutesRange)
        .max(1440, e.staleMinutesRange),
      digest: z.enum(DIGEST_KINDS as [DigestKind, ...DigestKind[]], e.unknownDigest),
```

Also import the type: `import { DIGEST_KINDS, getSettings, toPublicSettings, updateSettings, type DigestKind, type SettingsPatch } from "@/lib/settings";`.

- [ ] **Step 5: Add the fields to `components/SettingsForm.tsx`**

Add to `FormState`: `stale_after_minutes: string; digest: string;`. In `toForm`: `stale_after_minutes: String(s.stale_after_minutes), digest: s.digest,`. In the `payload` of `onSubmit`: `stale_after_minutes: Number(form.stale_after_minutes), digest: form.digest,`.

Add a new `Section` after the `monitoringSection` one and before the submit button:

```tsx
      <Section title={d.settings.scheduleSection} description={d.settings.scheduleSectionHint}>
        <div className="grid gap-4 sm:grid-cols-2 sm:max-w-lg">
          <div>
            <label htmlFor="stale_after_minutes" className={labelClass}>
              {d.settings.staleAfterMinutes}
            </label>
            <input
              id="stale_after_minutes"
              type="number"
              min="0"
              max="1440"
              step="1"
              required
              value={form.stale_after_minutes}
              onChange={(e) => update("stale_after_minutes", e.target.value)}
              className={inputClass}
            />
            <p className={hintClass}>{d.settings.staleAfterMinutesHint}</p>
          </div>
          <div>
            <label htmlFor="digest" className={labelClass}>
              {d.settings.digest}
            </label>
            <select
              id="digest"
              value={form.digest}
              onChange={(e) => update("digest", e.target.value)}
              className={inputClass}
            >
              <option value="off">{d.settings.digestOff}</option>
              <option value="weekly">{d.settings.digestWeekly}</option>
              <option value="cycle">{d.settings.digestCycle}</option>
            </select>
            <p className={hintClass}>{d.settings.digestHint}</p>
          </div>
        </div>
      </Section>
```

- [ ] **Step 6: Dictionary entries**

`lib/i18n/dictionaries/en.ts`, inside `settings:` before `fields:`:

```ts
    scheduleSection: "Scheduled checks",
    scheduleSectionHint:
      "Run by the scheduler that calls /api/cron/tick (see README, \"Scheduled jobs\"). Without a scheduler these two settings do nothing.",
    staleAfterMinutes: "Silence before alerting (minutes)",
    staleAfterMinutesHint: "Email when no reading has arrived for this long. 0 turns it off.",
    digest: "Scheduled summary",
    digestOff: "Off",
    digestWeekly: "Weekly, Monday at 08:00",
    digestCycle: "Start of each billing cycle, 08:00",
    digestHint: "The same report as the quota alert, sent on a schedule.",
```

Inside `settings.fields`:

```ts
      stale_after_minutes: "Silence before alerting",
      digest: "Scheduled summary",
```

Inside `errors:`:

```ts
    staleMinutesWhole: "The silence limit must be a whole number of minutes.",
    staleMinutesRange: "The silence limit must be between 0 and 1440 minutes.",
    unknownDigest: "That summary schedule is not supported.",
```

`lib/i18n/dictionaries/ar.ts`, same keys in the same places:

```ts
    scheduleSection: "الفحوصات المجدولة",
    scheduleSectionHint:
      "تُنفَّذ بواسطة المجدول الذي يستدعي /api/cron/tick (راجع README، قسم Scheduled jobs). من دون مجدول لا يؤثر هذان الإعدادان.",
    staleAfterMinutes: "مدة الصمت قبل التنبيه (دقائق)",
    staleAfterMinutesHint: "إرسال بريد عندما لا تصل أي قراءة طوال هذه المدة. القيمة 0 تعطّل التنبيه.",
    digest: "الملخص المجدول",
    digestOff: "متوقف",
    digestWeekly: "أسبوعياً، الاثنين الساعة 08:00",
    digestCycle: "بداية كل دورة فوترة، الساعة 08:00",
    digestHint: "التقرير نفسه المرسل عند تجاوز الحصة، لكن وفق جدول زمني.",
```

```ts
      stale_after_minutes: "مدة الصمت قبل التنبيه",
      digest: "الملخص المجدول",
```

```ts
    staleMinutesWhole: "يجب أن تكون مدة الصمت عدداً صحيحاً من الدقائق.",
    staleMinutesRange: "يجب أن تكون مدة الصمت بين 0 و1440 دقيقة.",
    unknownDigest: "جدول الملخص هذا غير مدعوم.",
```

- [ ] **Step 7: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass (the dictionary parity test in `lib/i18n.test.ts` confirms both languages have every key).

Then `pnpm dev`, open `/en/settings`, set silence to 15 and the summary to Weekly, save. Expected: toast "Settings saved."; reloading shows the saved values.

---

### Task 2: Pure schedule logic

**Files:**
- Create: `lib/cron/schedule.ts`
- Test: `lib/cron/schedule.test.ts`

**Interfaces:**
- Consumes: `localParts(date, timeZone): LocalParts` and `localTimeInstant(date, time, timeZone, minuteOffset?)` from `lib/time.ts`; `cycleBounds(now, cycleDay, timezone, offset?)` from `lib/billing.ts`; `DigestKind` from `lib/settings.ts`.
- Produces:
  - `export function isStale(lastReadingAt: Date | null, now: Date, staleAfterMinutes: number): boolean`
  - `export const DIGEST_HOUR = "08:00"`
  - `export function digestDueAt(kind: DigestKind, now: Date, cycleDay: number, timezone: string): Date | null` (the latest scheduled instant at or before `now`; null when `kind` is `"off"`)
  - `export function isDigestDue(kind: DigestKind, now: Date, lastSentAt: Date | null, cycleDay: number, timezone: string): boolean`
  - `export function digestReportDate(kind: DigestKind, dueAt: Date, cycleDay: number, timezone: string): { date: string; asOf: Date }` (the local date the report is about and the instant it is measured up to)

- [ ] **Step 1: Write the failing tests**

`lib/cron/schedule.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { digestDueAt, digestReportDate, isDigestDue, isStale } from "@/lib/cron/schedule";

const TZ = "Asia/Beirut"; // UTC+3 in September 2026

/** A Beirut wall-clock time as an instant. September is UTC+3. */
function beirut(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+03:00`);
}

describe("isStale", () => {
  const now = beirut("2026-09-14", "12:00");

  test("is false when readings are recent", () => {
    expect(isStale(beirut("2026-09-14", "11:55"), now, 10)).toBe(false);
  });

  test("is true once the silence exceeds the limit", () => {
    expect(isStale(beirut("2026-09-14", "11:49"), now, 10)).toBe(true);
  });

  test("is false exactly at the limit", () => {
    // Ten minutes of silence is "up to ten minutes", not "more than".
    expect(isStale(beirut("2026-09-14", "11:50"), now, 10)).toBe(false);
  });

  test("is never stale when the limit is 0", () => {
    expect(isStale(beirut("2026-09-01", "00:00"), now, 0)).toBe(false);
  });

  test("is not stale with no reading at all", () => {
    // Nothing to compare against; a fresh install is not an outage.
    expect(isStale(null, now, 10)).toBe(false);
  });
});

describe("digestDueAt", () => {
  test("off has no due instant", () => {
    expect(digestDueAt("off", beirut("2026-09-14", "09:00"), 5, TZ)).toBeNull();
  });

  test("weekly: Monday after 08:00 is due that Monday at 08:00", () => {
    // 2026-09-14 is a Monday.
    expect(digestDueAt("weekly", beirut("2026-09-14", "09:00"), 5, TZ)).toEqual(
      beirut("2026-09-14", "08:00"),
    );
  });

  test("weekly: Monday at 07:59 still belongs to the previous Monday", () => {
    expect(digestDueAt("weekly", beirut("2026-09-14", "07:59"), 5, TZ)).toEqual(
      beirut("2026-09-07", "08:00"),
    );
  });

  test("weekly: exactly 08:00 counts", () => {
    expect(digestDueAt("weekly", beirut("2026-09-14", "08:00"), 5, TZ)).toEqual(
      beirut("2026-09-14", "08:00"),
    );
  });

  test("weekly: a Thursday points back to the Monday before", () => {
    expect(digestDueAt("weekly", beirut("2026-09-17", "15:00"), 5, TZ)).toEqual(
      beirut("2026-09-14", "08:00"),
    );
  });

  test("cycle: the 5th at 09:00 is due on the 5th at 08:00", () => {
    expect(digestDueAt("cycle", beirut("2026-09-05", "09:00"), 5, TZ)).toEqual(
      beirut("2026-09-05", "08:00"),
    );
  });

  test("cycle: the 5th at 07:59 is still the previous cycle's morning", () => {
    expect(digestDueAt("cycle", beirut("2026-09-05", "07:59"), 5, TZ)).toEqual(
      beirut("2026-08-05", "08:00"),
    );
  });

  test("cycle: mid-cycle points at the current cycle's first morning", () => {
    expect(digestDueAt("cycle", beirut("2026-09-20", "12:00"), 5, TZ)).toEqual(
      beirut("2026-09-05", "08:00"),
    );
  });

  test("cycle: a cycle day past the end of a short month clamps", () => {
    // February 2026 has 28 days; a cycle day of 31 starts on the 28th.
    expect(digestDueAt("cycle", new Date("2026-03-10T12:00:00+02:00"), 31, TZ)).toEqual(
      new Date("2026-02-28T08:00:00+02:00"),
    );
  });
});

describe("isDigestDue", () => {
  const monday9 = beirut("2026-09-14", "09:00");

  test("never sent: due at the first tick", () => {
    expect(isDigestDue("weekly", monday9, null, 5, TZ)).toBe(true);
  });

  test("sent before this Monday 08:00: due", () => {
    expect(isDigestDue("weekly", monday9, beirut("2026-09-07", "08:03"), 5, TZ)).toBe(true);
  });

  test("sent after this Monday 08:00: not due again", () => {
    expect(isDigestDue("weekly", monday9, beirut("2026-09-14", "08:02"), 5, TZ)).toBe(false);
  });

  test("off: never due, even if never sent", () => {
    expect(isDigestDue("off", monday9, null, 5, TZ)).toBe(false);
  });

  test("cycle: sent last cycle, now past this cycle's morning: due", () => {
    expect(isDigestDue("cycle", beirut("2026-09-05", "08:10"), beirut("2026-08-05", "08:05"), 5, TZ)).toBe(true);
  });

  test("cycle: sent this cycle: not due", () => {
    expect(isDigestDue("cycle", beirut("2026-09-20", "12:00"), beirut("2026-09-05", "08:05"), 5, TZ)).toBe(false);
  });
});

describe("digestReportDate", () => {
  test("weekly reports on the day before the due instant, measured up to local midnight", () => {
    const { date, asOf } = digestReportDate("weekly", beirut("2026-09-14", "08:00"), 5, TZ);
    expect(date).toBe("2026-09-13");
    expect(asOf).toEqual(beirut("2026-09-14", "00:00"));
  });

  test("cycle reports on the last day of the previous cycle, measured up to the cycle end", () => {
    const { date, asOf } = digestReportDate("cycle", beirut("2026-09-05", "08:00"), 5, TZ);
    expect(date).toBe("2026-09-04");
    expect(asOf).toEqual(beirut("2026-09-05", "00:00"));
  });

  test("off yields the day before, so a caller never gets an invalid date", () => {
    const { date } = digestReportDate("off", beirut("2026-09-14", "08:00"), 5, TZ);
    expect(date).toBe("2026-09-13");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm exec vitest run lib/cron/schedule.test.ts`
Expected: FAIL, "Cannot find module '@/lib/cron/schedule'".

- [ ] **Step 3: Implement `lib/cron/schedule.ts`**

```ts
/**
 * When a scheduled job is due. Pure, so the calendar arithmetic is testable
 * without a clock or a database.
 *
 * Every "local" value is expressed in the timezone from settings, through the
 * same helpers the quota window uses, so a digest fires at 08:00 on the wall
 * clock whatever daylight saving does to the offset.
 */

import { cycleBounds } from "@/lib/billing";
import type { DigestKind } from "@/lib/settings";
import { localParts, localTimeInstant } from "@/lib/time";

/** Local wall-clock time a digest goes out. */
export const DIGEST_HOUR = "08:00";

/**
 * True once the silence since the last reading is longer than the limit.
 * 0 disables the check; no reading at all is not an outage but an empty
 * installation, and equally not stale.
 */
export function isStale(lastReadingAt: Date | null, now: Date, staleAfterMinutes: number): boolean {
  if (staleAfterMinutes <= 0 || !lastReadingAt) return false;
  const silentMs = now.getTime() - lastReadingAt.getTime();
  return silentMs > staleAfterMinutes * 60_000;
}

/** YYYY-MM-DD shifted by whole days, staying on the calendar. */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 for Monday through 6 for Sunday, read at midday UTC so no zone shifts the day. */
function daysSinceMonday(date: string): number {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 is Sunday
  return (weekday + 6) % 7;
}

/**
 * The latest scheduled instant at or before `now`.
 *
 * Weekly: the most recent Monday 08:00 local. Cycle: 08:00 local on the first
 * day of the billing cycle that contains `now`, or of the previous cycle when
 * that morning has not arrived yet.
 */
export function digestDueAt(
  kind: DigestKind,
  now: Date,
  cycleDay: number,
  timezone: string,
): Date | null {
  if (kind === "off") return null;

  if (kind === "weekly") {
    const today = localParts(now, timezone).date;
    let monday = shiftDate(today, -daysSinceMonday(today));
    let due = localTimeInstant(monday, DIGEST_HOUR, timezone);
    if (!due) return null;
    if (due > now) {
      monday = shiftDate(monday, -7);
      due = localTimeInstant(monday, DIGEST_HOUR, timezone);
    }
    return due;
  }

  const current = cycleBounds(now, cycleDay, timezone);
  let due = localTimeInstant(localParts(current.start, timezone).date, DIGEST_HOUR, timezone);
  if (!due) return null;
  if (due > now) {
    const previous = cycleBounds(now, cycleDay, timezone, -1);
    due = localTimeInstant(localParts(previous.start, timezone).date, DIGEST_HOUR, timezone);
  }
  return due;
}

/**
 * Due when the schedule's latest instant has passed and nothing was sent since.
 * Never sent means due now: the first tick after the digest is switched on
 * sends one, which doubles as proof that the scheduler works.
 */
export function isDigestDue(
  kind: DigestKind,
  now: Date,
  lastSentAt: Date | null,
  cycleDay: number,
  timezone: string,
): boolean {
  const due = digestDueAt(kind, now, cycleDay, timezone);
  if (!due) return false;
  return lastSentAt === null || lastSentAt < due;
}

/**
 * What a digest that fires at `dueAt` reports on: the day before, measured up
 * to that day's end. For the cycle digest that end is the cycle's end, which
 * is local midnight on the due day, the same instant.
 */
export function digestReportDate(
  kind: DigestKind,
  dueAt: Date,
  cycleDay: number,
  timezone: string,
): { date: string; asOf: Date } {
  const dueDay = localParts(dueAt, timezone).date;
  const date = shiftDate(dueDay, -1);
  const asOf = localTimeInstant(dueDay, "00:00", timezone) ?? dueAt;
  void kind;
  void cycleDay;
  return { date, asOf };
}
```

Note: `digestReportDate` takes `kind` and `cycleDay` so its signature can grow (a cycle digest measured to the cycle end is, by construction of `digestDueAt`, the same as local midnight of the due day); the `void` lines keep lint quiet without dropping the parameters from the contract.

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run lib/cron/schedule.test.ts`
Expected: PASS, 23 tests.

- [ ] **Step 5: Verify the whole suite**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass.

---

### Task 3: The tick: job registry, run log, endpoint

**Files:**
- Create: `lib/cron/jobs.ts`
- Create: `lib/cron/runs.ts`
- Create: `lib/cron/tick.ts`
- Create: `app/api/cron/tick/route.ts`
- Modify: `proxy.ts` (the `PUBLIC_API` set)

**Interfaces:**
- Consumes: `isCronAuthorized(request)`, `errorResponse(err)` from `lib/api.ts`; `getSettings()` from `lib/settings.ts`; `db` from `lib/db.ts`.
- Produces (used by plan 06 to append a job):
  - `lib/cron/jobs.ts`: `export interface JobContext { now: Date; settings: SettingsRow }`, `export interface JobResult { status: "ok" | "failed" | "skipped"; detail?: string | null }`, `export interface Job { name: string; run(ctx: JobContext): Promise<JobResult> }`, `export const JOBS: Job[]`.
  - `lib/cron/runs.ts`: `export interface JobRun { job: string; last_run_at: Date; last_status: string; last_detail: string | null }`, `export function getJobRun(name: string): Promise<JobRun | null>`, `export function recordJobRun(name: string, status: string, detail: string | null, at?: Date): Promise<void>`.
  - `lib/cron/tick.ts`: `export interface TickJobReport { name: string; status: "ok" | "failed" | "skipped"; detail: string | null; ms: number }`, `export interface TickResponse { ran_at: string; jobs: TickJobReport[] }`, `export function runTick(now?: Date): Promise<TickResponse>`.

- [ ] **Step 1: `lib/cron/runs.ts`**

```ts
import { db } from "@/lib/db";

export interface JobRun {
  job: string;
  last_run_at: Date;
  last_status: string;
  last_detail: string | null;
}

export function getJobRun(name: string): Promise<JobRun | null> {
  return db.oneOrNone<JobRun>("SELECT job, last_run_at, last_status, last_detail FROM job_runs WHERE job = $1", [
    name,
  ]);
}

export function recordJobRun(name: string, status: string, detail: string | null, at = new Date()): Promise<void> {
  return db.none(
    `INSERT INTO job_runs (job, last_run_at, last_status, last_detail)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (job) DO UPDATE
       SET last_run_at = EXCLUDED.last_run_at,
           last_status = EXCLUDED.last_status,
           last_detail = EXCLUDED.last_detail`,
    [name, at, status, detail],
  );
}
```

- [ ] **Step 2: `lib/cron/jobs.ts`**

```ts
/**
 * The jobs /api/cron/tick runs, in order.
 *
 * A job must be safe to run every minute: it reads its own state (job_runs,
 * the alerts log, the readings) and returns "skipped" when there is nothing to
 * do. It must never throw for an expected condition; the tick catches what it
 * does throw and records it as "failed" without stopping the jobs after it.
 */

import type { SettingsRow } from "@/lib/settings";

export interface JobContext {
  now: Date;
  settings: SettingsRow;
}

export interface JobResult {
  status: "ok" | "failed" | "skipped";
  detail?: string | null;
}

export interface Job {
  name: string;
  run(ctx: JobContext): Promise<JobResult>;
}

/** Filled in by the modules that define jobs (stale, digest, and later thinning). */
export const JOBS: Job[] = [];
```

- [ ] **Step 3: `lib/cron/tick.ts`**

```ts
import { JOBS, type JobResult } from "@/lib/cron/jobs";
import { recordJobRun } from "@/lib/cron/runs";
import { getSettings } from "@/lib/settings";

// Importing the job modules registers them. Order here is the run order.
import "@/lib/cron/stale";
import "@/lib/cron/digest";

export interface TickJobReport {
  name: string;
  status: JobResult["status"];
  detail: string | null;
  ms: number;
}

export interface TickResponse {
  ran_at: string;
  jobs: TickJobReport[];
}

/**
 * Run every registered job once, in sequence. A job that throws is recorded as
 * failed and the next one still runs: the stale check must not be lost because
 * the digest's aggregate timed out.
 *
 * "skipped" results are reported but not written to job_runs, so a row's
 * last_run_at is the last time the job actually did work (or failed). Jobs that
 * pace themselves from job_runs (plan 06's thinning) rely on this: with a
 * five-minute tick, recording skips would push last_run_at forward forever.
 */
export async function runTick(now = new Date()): Promise<TickResponse> {
  const settings = await getSettings();
  const jobs: TickJobReport[] = [];

  for (const job of JOBS) {
    const started = Date.now();
    let result: JobResult;
    try {
      result = await job.run({ now, settings });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[cron] ${job.name} failed:`, err);
      result = { status: "failed", detail };
    }
    const ms = Date.now() - started;
    if (result.status !== "skipped") {
      try {
        await recordJobRun(job.name, result.status, result.detail ?? null, now);
      } catch (err) {
        console.error(`[cron] could not record run of ${job.name}:`, err);
      }
    }
    jobs.push({ name: job.name, status: result.status, detail: result.detail ?? null, ms });
  }

  return { ran_at: now.toISOString(), jobs };
}
```

The two `import "@/lib/cron/stale"` / `"@/lib/cron/digest"` lines will fail to resolve until Tasks 5 and 7 create those files. For this task, create both as placeholders that only register nothing:

`lib/cron/stale.ts` (temporary content, replaced in Task 5):

```ts
// Registered in Task 5.
export {};
```

`lib/cron/digest.ts` (temporary content, replaced in Task 7):

```ts
// Registered in Task 7.
export {};
```

- [ ] **Step 4: The route `app/api/cron/tick/route.ts`**

```ts
import { NextResponse } from "next/server";
import { errorResponse, isCronAuthorized } from "@/lib/api";
import { runTick } from "@/lib/cron/tick";

export const maxDuration = 60;

/**
 * The heartbeat. Called by whichever scheduler the deployment has (Vercel
 * Cron, a GitHub Actions schedule, a curl loop next to the container), and by
 * hand for testing. GET and POST behave the same because Vercel Cron and
 * GitHub's curl send GET while the docs and the router idiom use POST.
 * Requires `Authorization: Bearer $CRON_SECRET`, the same secret as the ingest.
 */
async function handle(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runTick();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}
```

- [ ] **Step 5: Make it public in `proxy.ts`**

In the `PUBLIC_API` set add `"/api/cron/tick",` after `"/api/health",`.

- [ ] **Step 6: Try it**

With `pnpm dev` running and `CRON_SECRET` from `.env.local`:

```bash
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/cron/tick
```

Expected: first prints `{"ran_at":"...","jobs":[]}`; second prints `401`. `psql "$DATABASE_URL" -c "SELECT * FROM job_runs"` is still empty (no jobs registered yet).

- [ ] **Step 7: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass.

---

### Task 4: The link email (stale and recovered), pure and tested

**Files:**
- Create: `lib/email-link-template.ts`
- Test: `lib/email-link-template.test.ts`
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts` (new namespace `emailLink`)

**Interfaces:**
- Consumes: `RenderedEmail` from `lib/email-template.ts`; `fill`, `getDictionaryFor` from `lib/i18n`; `DIRECTION`, `Locale` from `lib/i18n/config`; `formatDuration` from `lib/time.ts`; `makeFormatters` from `lib/i18n/format.ts`.
- Produces:
  ```ts
  export interface LinkReport {
    kind: "stale" | "recovered";
    locale: Locale;
    last_reading_at: string | null;   // ISO; null when no reading was ever stored
    silent_seconds: number;           // how long the router was (or had been) quiet
    timezone: string;
    app_url: string | null;
  }
  export function renderLinkEmail(report: LinkReport): RenderedEmail;
  ```

- [ ] **Step 1: Dictionary entries**

`en.ts`, a new top-level namespace after `emailAlert:`:

```ts
  /** The "router has gone quiet" mail and its all-clear. */
  emailLink: {
    subjectStale: "No data from the router for {duration}",
    subjectRecovered: "The router is reporting again",
    headingStale: "The router has gone quiet",
    headingRecovered: "Readings have resumed",
    bodyStale:
      "The last reading arrived at {time} ({timezone}). Nothing has been received for {duration}.",
    bodyStaleNever: "No reading has ever been received from the router.",
    bodyRecovered: "Readings resumed after {duration} of silence. The last one arrived at {time} ({timezone}).",
    causes: "This usually means one of:",
    causePower: "the router is off or rebooting",
    causeLink: "the router is up but its internet link is down, so it cannot reach this app",
    causeScript: "the quota-push scheduler on the router has stopped or its secret has changed",
    causeApp: "this app was unreachable from the router",
    checkHint: "On the router, Log shows a quota-push line for every attempt; \"failed\" there means the router could not reach the app.",
    openDashboard: "Open the dashboard",
    footerStale: "You will get one more mail when readings resume.",
    footerRecovered: "No further mail unless the router goes quiet again.",
    dashboardLine: "Dashboard: {url}",
  },
```

`ar.ts`, same place and keys:

```ts
  emailLink: {
    subjectStale: "لا بيانات من الراوتر منذ {duration}",
    subjectRecovered: "عاد الراوتر إلى الإبلاغ",
    headingStale: "توقف الراوتر عن الإبلاغ",
    headingRecovered: "استؤنفت القراءات",
    bodyStale: "وصلت آخر قراءة في {time} ({timezone}). لم يصل شيء منذ {duration}.",
    bodyStaleNever: "لم تصل أي قراءة من الراوتر على الإطلاق.",
    bodyRecovered: "استؤنفت القراءات بعد صمت دام {duration}. وصلت الأخيرة في {time} ({timezone}).",
    causes: "يعني هذا عادةً أحد الأمور التالية:",
    causePower: "الراوتر مطفأ أو يعيد التشغيل",
    causeLink: "الراوتر يعمل لكن اتصاله بالإنترنت منقطع، فلا يستطيع الوصول إلى هذا التطبيق",
    causeScript: "توقف مجدول quota-push على الراوتر أو تغيّر السر الخاص به",
    causeApp: "تعذّر على الراوتر الوصول إلى هذا التطبيق",
    checkHint: "على الراوتر، يُظهر السجل سطر quota-push لكل محاولة؛ ظهور failed هناك يعني أن الراوتر لم يصل إلى التطبيق.",
    openDashboard: "فتح لوحة التحكم",
    footerStale: "ستصلك رسالة أخرى واحدة عند استئناف القراءات.",
    footerRecovered: "لا رسائل أخرى ما لم يتوقف الراوتر عن الإبلاغ مجدداً.",
    dashboardLine: "لوحة التحكم: {url}",
  },
```

- [ ] **Step 2: Write the failing tests**

`lib/email-link-template.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { renderLinkEmail, type LinkReport } from "@/lib/email-link-template";

function report(overrides: Partial<LinkReport> = {}): LinkReport {
  return {
    kind: "stale",
    locale: "en",
    last_reading_at: "2026-09-14T08:12:00.000Z", // 11:12 in Beirut
    silent_seconds: 1500, // 25m 00s
    timezone: "Asia/Beirut",
    app_url: null,
    ...overrides,
  };
}

describe("renderLinkEmail", () => {
  test("stale: subject carries the silence, body carries the last reading", () => {
    const { subject, text, html } = renderLinkEmail(report());
    expect(subject).toBe("No data from the router for 25m 00s");
    expect(text).toContain("11:12, 14 Sep (Asia/Beirut)");
    expect(text).toContain("25m 00s");
    expect(html).toContain("The router has gone quiet");
    expect(html).toContain("quota-push");
  });

  test("stale with no reading ever says so instead of a time", () => {
    const { text } = renderLinkEmail(report({ last_reading_at: null }));
    expect(text).toContain("No reading has ever been received");
    expect(text).not.toContain("(Asia/Beirut)");
  });

  test("recovered: different subject, heading and footer", () => {
    const { subject, text, html } = renderLinkEmail(report({ kind: "recovered", silent_seconds: 3720 }));
    expect(subject).toBe("The router is reporting again");
    expect(text).toContain("1h 02m");
    expect(html).toContain("Readings have resumed");
    expect(text).toContain("No further mail unless");
    expect(html).not.toContain("usually means one of");
  });

  test("dashboard link appears only when configured", () => {
    expect(renderLinkEmail(report()).html).not.toContain("Open the dashboard");
    const withUrl = renderLinkEmail(report({ app_url: "https://netmonitor.example" }));
    expect(withUrl.html).toContain('href="https://netmonitor.example"');
    expect(withUrl.text).toContain("Dashboard: https://netmonitor.example");
  });

  test("Arabic is right to left and has no English prose", () => {
    const { html, text } = renderLinkEmail(report({ locale: "ar" }));
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain("gone quiet");
    expect(text).toContain("توقف الراوتر عن الإبلاغ");
    // Durations take the Arabic suffixes.
    expect(text).toContain("25د 00ث");
  });

  test("escapes the timezone and url, which come from settings and the environment", () => {
    const { html } = renderLinkEmail(report({ timezone: "<script>", app_url: "https://x/?a=1&b=2" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("https://x/?a=1&amp;b=2");
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm exec vitest run lib/email-link-template.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `lib/email-link-template.ts`**

```ts
/**
 * The mail sent when the router stops pushing, and its all-clear.
 *
 * Pure, like lib/email-template.ts: a report in, subject/text/html out. Short
 * enough to be inline-styled by hand; it borrows the palette of the alert mail
 * so the two read as one product.
 */

import type { RenderedEmail } from "@/lib/email-template";
import { fill, getDictionaryFor } from "@/lib/i18n";
import { DIRECTION, type Locale } from "@/lib/i18n/config";
import { makeFormatters } from "@/lib/i18n/format";
import { formatDuration } from "@/lib/time";

export interface LinkReport {
  kind: "stale" | "recovered";
  locale: Locale;
  /** ISO instant of the newest stored reading; null when none exists. */
  last_reading_at: string | null;
  /** Length of the silence: current for "stale", the one that ended for "recovered". */
  silent_seconds: number;
  timezone: string;
  app_url: string | null;
}

const FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const FONT_AR = "Segoe UI,Tahoma,Geeza Pro,Noto Naskh Arabic,Arial,sans-serif";

const C = {
  bg: "#fafaf9",
  card: "#ffffff",
  ink: "#171717",
  muted: "#71717a",
  border: "#e4e4e7",
  red: "#b91c1c",
  redTint: "#fef2f2",
  green: "#15803d",
  greenTint: "#f0fdf4",
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export function renderLinkEmail(report: LinkReport): RenderedEmail {
  const d = getDictionaryFor(report.locale);
  const t = d.emailLink;
  const f = makeFormatters(report.locale, d);
  const dir = DIRECTION[report.locale];
  const font = report.locale === "ar" ? FONT_AR : FONT;
  const duration = formatDuration(report.silent_seconds, d.duration);
  const time = report.last_reading_at ? f.stamp(report.last_reading_at, report.timezone) : null;
  const stale = report.kind === "stale";

  const subject = stale ? fill(t.subjectStale, { duration }) : t.subjectRecovered;
  const heading = stale ? t.headingStale : t.headingRecovered;
  const body = stale
    ? time
      ? fill(t.bodyStale, { time, timezone: report.timezone, duration })
      : t.bodyStaleNever
    : fill(t.bodyRecovered, { duration, time: time ?? "-", timezone: report.timezone });
  const footer = stale ? t.footerStale : t.footerRecovered;
  const causes = stale ? [t.causePower, t.causeLink, t.causeScript, t.causeApp] : [];

  const textLines = [heading, "", body];
  if (stale) {
    textLines.push("", t.causes, ...causes.map((c) => `  - ${c}`), "", t.checkHint);
  }
  textLines.push("", footer);
  if (report.app_url) textLines.push(fill(t.dashboardLine, { url: report.app_url }));
  const text = textLines.join("\n");

  const accent = stale ? { bg: C.redTint, color: C.red } : { bg: C.greenTint, color: C.green };
  const p = (inner: string, color = C.ink, size = 14) =>
    `<p style="margin:0 0 12px;font-family:${font};font-size:${size}px;line-height:1.5;color:${color}">${inner}</p>`;

  const causesHtml = stale
    ? p(esc(t.causes)) +
      `<ul style="margin:0 0 12px;padding-inline-start:20px;font-family:${font};font-size:14px;line-height:1.5;color:${C.ink}">` +
      causes.map((c) => `<li>${esc(c)}</li>`).join("") +
      `</ul>` +
      p(esc(t.checkHint), C.muted, 13)
    : "";

  const button = report.app_url
    ? `<p style="margin:16px 0 0"><a href="${esc(report.app_url)}" style="display:inline-block;background:${C.ink};color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-family:${font};font-size:14px">${esc(t.openDashboard)}</a></p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="${report.locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:24px 12px;background:${C.bg}">
<div dir="${dir}" style="max-width:520px;margin:0 auto;background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:20px 22px;text-align:${dir === "rtl" ? "right" : "left"}">
  <div style="display:inline-block;background:${accent.bg};color:${accent.color};font-family:${font};font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border-radius:999px;margin-bottom:12px">${esc(heading)}</div>
  ${p(esc(body))}
  ${causesHtml}
  ${p(esc(footer), C.muted, 12)}
  ${button}
</div>
</body>
</html>`;

  return { subject, text, html };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run lib/email-link-template.test.ts`
Expected: PASS, 6 tests. If the Arabic duration assertion fails, check the suffixes in `ar.duration` of the Arabic dictionary and match the test to them (the email-template test asserts `"2ي 8س 0د"` for the same helper).

- [ ] **Step 6: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass (the dictionary parity test now covers `emailLink`).

---

### Task 5: The stale job

**Files:**
- Modify (replace placeholder): `lib/cron/stale.ts`

**Interfaces:**
- Consumes: `isStale` from `lib/cron/schedule.ts`; `JOBS`, `Job`, `JobContext`, `JobResult` from `lib/cron/jobs.ts`; `getLatestReading()` from `lib/usage.ts`; `latestAlert(kind, scopeKey?)` from `lib/alerts/log.ts` (plan 01); `dispatchAlert` from `lib/alerts/dispatch.ts` (plan 01); `renderLinkEmail` from `lib/email-link-template.ts`; `alertLocale` from `lib/settings.ts`.
- Produces: `export const staleJob: Job` (name `"stale"`), registered by `JOBS.push(staleJob)` at module load. Alert rows: kind `link_stale` / `link_recovered`, `scope_key` `"link"`, `level` null, payload `{ last_reading_at, silent_seconds }`.

- [ ] **Step 1: Implement `lib/cron/stale.ts`**

```ts
/**
 * "The router has gone quiet."
 *
 * Nothing runs when the router stops pushing, which is exactly why this check
 * cannot live on the ingest path and has to be driven by the tick. It sends
 * one mail when the silence passes the limit and one more when readings
 * resume. The alerts log is the state: the newest link_* row says whether an
 * outage is currently being reported.
 */

import { dispatchAlert } from "@/lib/alerts/dispatch";
import { latestAlert } from "@/lib/alerts/log";
import { JOBS, type Job, type JobContext, type JobResult } from "@/lib/cron/jobs";
import { isStale } from "@/lib/cron/schedule";
import { renderLinkEmail } from "@/lib/email-link-template";
import { alertLocale } from "@/lib/settings";
import { getLatestReading } from "@/lib/usage";

const SCOPE = "link";

function appUrl(): string | null {
  const raw = process.env.APP_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

async function run({ now, settings }: JobContext): Promise<JobResult> {
  if (settings.stale_after_minutes <= 0) {
    return { status: "skipped", detail: "stale_after_minutes is 0" };
  }

  const [latest, lastStale, lastRecovered] = await Promise.all([
    getLatestReading(),
    latestAlert("link_stale", SCOPE),
    latestAlert("link_recovered", SCOPE),
  ]);
  const lastReadingAt = latest?.recorded_at ?? null;

  // An outage is "open" when the newest link row is a stale alert that was
  // sent after the newest reading: nothing has arrived since we complained.
  const outageOpen =
    lastStale !== null &&
    (lastRecovered === null || lastStale.created_at > lastRecovered.created_at) &&
    (lastReadingAt === null || lastStale.created_at > lastReadingAt);

  const stale = isStale(lastReadingAt, now, settings.stale_after_minutes);
  const silentSeconds = lastReadingAt ? Math.round((now.getTime() - lastReadingAt.getTime()) / 1000) : 0;

  if (stale && !outageOpen) {
    const email = renderLinkEmail({
      kind: "stale",
      locale: alertLocale(settings),
      last_reading_at: lastReadingAt?.toISOString() ?? null,
      silent_seconds: silentSeconds,
      timezone: settings.timezone,
      app_url: appUrl(),
    });
    const { status } = await dispatchAlert({
      kind: "link_stale",
      level: null,
      scopeKey: SCOPE,
      to: settings.alert_email_to,
      email,
      payload: { last_reading_at: lastReadingAt?.toISOString() ?? null, silent_seconds: silentSeconds },
    });
    return { status: status === "failed" ? "failed" : "ok", detail: `link_stale ${status}` };
  }

  if (!stale && outageOpen && lastReadingAt) {
    // Readings are back. The silence that ended ran from the last reading
    // before the complaint to the first reading after it; the complaint's
    // payload remembers the former.
    const before = typeof lastStale.payload?.last_reading_at === "string"
      ? new Date(lastStale.payload.last_reading_at)
      : null;
    const ended = before ? Math.round((lastReadingAt.getTime() - before.getTime()) / 1000) : 0;
    const email = renderLinkEmail({
      kind: "recovered",
      locale: alertLocale(settings),
      last_reading_at: lastReadingAt.toISOString(),
      silent_seconds: ended,
      timezone: settings.timezone,
      app_url: appUrl(),
    });
    const { status } = await dispatchAlert({
      kind: "link_recovered",
      level: null,
      scopeKey: SCOPE,
      to: settings.alert_email_to,
      email,
      payload: { last_reading_at: lastReadingAt.toISOString(), silent_seconds: ended },
    });
    return { status: status === "failed" ? "failed" : "ok", detail: `link_recovered ${status}` };
  }

  return {
    status: "skipped",
    detail: stale ? "outage already reported" : `last reading ${silentSeconds}s ago`,
  };
}

export const staleJob: Job = { name: "stale", run };

JOBS.push(staleJob);
```

Note on `outageOpen`: when the router resumes, the first new reading is newer than the stale row, so `outageOpen` stays true only through the `lastRecovered` comparison; the third condition (`lastStale.created_at > lastReadingAt`) is what turns it false, and the recovery branch runs because `lastRecovered` is still older than `lastStale`. Re-read the two branches with that in mind: the recovery branch's condition must therefore not include the third clause. Replace `outageOpen` in the recovery branch with `reportedAndNotCleared`:

```ts
  const reportedAndNotCleared =
    lastStale !== null && (lastRecovered === null || lastStale.created_at > lastRecovered.created_at);
```

and change the recovery `if` to `if (!stale && reportedAndNotCleared && lastReadingAt)`. Keep `outageOpen` (with all three clauses) for the stale branch so a fresh outage after a recovery mail is reported again.

- [ ] **Step 2: Exercise it by hand**

With `pnpm dev` running, set silence to 1 minute on `/settings`, stop the router's push (on the router: `/system scheduler disable schedule1`, or simply wait if it is not pushing to your dev database), wait two minutes, then:

```bash
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

Expected: `jobs[0]` is `{"name":"stale","status":"ok","detail":"link_stale sent",...}` and a mail arrives; a second call reports `"outage already reported"`. Re-enable the scheduler (`/system scheduler enable schedule1`), wait for a reading, call again: `link_recovered sent`. `psql "$DATABASE_URL" -c "SELECT kind, status, created_at FROM alerts ORDER BY id DESC LIMIT 3"` shows both rows. Restore the silence setting to 10.

- [ ] **Step 3: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass.

---

### Task 6: Digest wording on the existing report

**Files:**
- Modify: `lib/email-template.ts` (`AlertReport`, `subjectLine`, `renderText`, `renderHtml`)
- Modify: `lib/email-report.ts` (`AlertReportInput.kind`, pass-through of `digest`)
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts` (`emailAlert`)
- Test: `lib/email-template.test.ts`

**Interfaces:**
- Produces: `AlertReport.kind: "alert" | "test" | "digest"`; new optional `AlertReport.digest?: "weekly" | "cycle"`; `AlertReportInput.kind` widened the same way and `AlertReportInput.digest?: "weekly" | "cycle"` copied onto the report by `buildAlertReport` and `minimalAlertReport`.

- [ ] **Step 1: Dictionary entries**

`en.ts`, inside `emailAlert:` after `subjectReport`:

```ts
    subjectDigest: "Weekly internet report: {used} of {quota} on {date}",
    subjectDigestCycle: "Billing cycle report: {used} of {quota} on {date}",
    introDigest: "Your scheduled internet summary.",
    eyebrowDigest: "Scheduled summary",
    digestFooter: "Sent on schedule. Change or stop it under Settings, Scheduled checks.",
```

`ar.ts`, same place:

```ts
    subjectDigest: "تقرير الإنترنت الأسبوعي: {used} من {quota} في {date}",
    subjectDigestCycle: "تقرير دورة الفوترة: {used} من {quota} في {date}",
    introDigest: "ملخص الإنترنت المجدول.",
    eyebrowDigest: "ملخص مجدول",
    digestFooter: "أُرسل وفق الجدول. يمكن تغييره أو إيقافه من الإعدادات، الفحوصات المجدولة.",
```

- [ ] **Step 2: Write the failing tests**

Append to `lib/email-template.test.ts`, inside the top-level `describe` (or as a new `describe("digest", ...)`):

```ts
describe("digest", () => {
  test("weekly digest: its own subject, intro, eyebrow and footer", () => {
    const { subject, text, html } = renderAlertEmail(report({ kind: "digest", digest: "weekly", threshold: null }));
    expect(subject).toBe("Weekly internet report: 12.40 GB of 10.00 GB on 2026-09-11");
    expect(text).toContain("Your scheduled internet summary.");
    expect(text).toContain("Sent on schedule.");
    expect(text).not.toContain("This is the only alert you will receive for today.");
    expect(html).toContain("Scheduled summary");
    expect(html).not.toContain("Test preview");
  });

  test("cycle digest: subject names the billing cycle", () => {
    const { subject } = renderAlertEmail(report({ kind: "digest", digest: "cycle", threshold: null }));
    expect(subject).toBe("Billing cycle report: 12.40 GB of 10.00 GB on 2026-09-11");
  });

  test("digest keeps the figures of a normal report", () => {
    const { html } = renderAlertEmail(report({ kind: "digest", digest: "weekly", threshold: null }));
    expect(html).toContain("12.40 GB");
    expect(html).toContain("Billing cycle");
  });
});
```

If plan 01 made `threshold` a required field of `AlertReport`, the `report()` fixture at the top of this test file already sets it; the `threshold: null` in these overrides is then redundant but harmless.

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm exec vitest run lib/email-template.test.ts`
Expected: FAIL, type error on `kind: "digest"` or subject mismatch.

- [ ] **Step 4: Widen the report type in `lib/email-template.ts`**

Change the `kind` field of `AlertReport`:

```ts
  /** A real over-quota alert, the preview sent from the settings page, or a scheduled summary. */
  kind: "alert" | "test" | "digest";
  /** Which schedule produced a digest. Ignored for the other kinds. */
  digest?: "weekly" | "cycle";
```

In `subjectLine`, replace the body with:

```ts
export function subjectLine(report: AlertReport): string {
  const st = styleFor(report.locale);
  const { today } = report;
  const over = today.used_bytes > today.quota_bytes;
  const prefix = report.kind === "test" ? st.t.testPrefix : "";
  const values = {
    used: formatBytes(today.used_bytes),
    quota: formatBytes(today.quota_bytes),
    percent: pct(today.percent),
    date: report.date,
  };
  if (report.kind === "digest") {
    return fill(report.digest === "cycle" ? st.t.subjectDigestCycle : st.t.subjectDigest, values);
  }
  return prefix + fill(over ? st.t.subjectExceeded : st.t.subjectReport, values);
}
```

If plan 01 already rewrote `subjectLine` to handle `report.threshold`, keep its threshold branch and add the digest branch before it (a digest never carries a threshold).

In `renderText`, the intro line:

```ts
    report.kind === "digest"
      ? t.introDigest
      : today.used_bytes > today.quota_bytes
        ? t.introExceeded
        : t.introReport,
```

(Plan 01 may have turned this into a threshold-aware expression; add the digest case as the first branch.)

The footer line at the end of `renderText`:

```ts
  lines.push(
    report.kind === "digest" ? t.digestFooter : report.kind === "test" ? t.testFooter : t.alertFooter,
  );
```

In `renderHtml`, the eyebrow:

```ts
        eyebrow(
          st,
          report.kind === "digest" ? t.eyebrowDigest : over ? t.eyebrowExceeded : t.eyebrowReport,
          headlineTone,
          headlineTone,
        ) +
```

and the footer note:

```ts
  const footerNote =
    report.kind === "digest" ? t.digestFooter : report.kind === "test" ? t.footerTest : t.alertFooter;
```

- [ ] **Step 5: Thread it through `lib/email-report.ts`**

In `AlertReportInput`:

```ts
  kind: "alert" | "test" | "digest";
  /** Only for kind "digest": which schedule produced it. */
  digest?: "weekly" | "cycle";
```

In the object returned by `buildAlertReport`, after `kind,`: add `digest: input.digest,`. In `minimalAlertReport`, after `kind: input.kind,`: add `digest: input.digest,`.

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run lib/email-template.test.ts`
Expected: PASS, including the three digest tests and every earlier one.

- [ ] **Step 7: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass.

---

### Task 7: The digest job

**Files:**
- Modify (replace placeholder): `lib/cron/digest.ts`

**Interfaces:**
- Consumes: `isDigestDue`, `digestDueAt`, `digestReportDate` from `lib/cron/schedule.ts`; `latestAlert("digest")` and `dispatchAlert` from plan 01; `buildAlertReport`, `minimalAlertReport` from `lib/email-report.ts`; `renderAlertEmail` from `lib/email-template.ts`; `getComplianceDays` from `lib/stats.ts`; `quotaBytes` from `lib/format.ts`; `localTimeInstant` from `lib/time.ts`.
- Produces: `export const digestJob: Job` (name `"digest"`), registered with `JOBS.push`. Alert rows: kind `digest`, `scope_key` `digest:<report date>`, level null, payload `{ digest, date, today, cycle, week }`.

- [ ] **Step 1: Implement `lib/cron/digest.ts`**

```ts
/**
 * The scheduled summary: the quota alert's report, sent on a calendar rather
 * than by a breach. Weekly on Monday morning about the week just ended, or on
 * the first morning of a billing cycle about the cycle just closed.
 *
 * The alerts log is the memory of what was sent: the newest digest row's
 * created_at is what isDigestDue compares against.
 */

import { dispatchAlert } from "@/lib/alerts/dispatch";
import { latestAlert } from "@/lib/alerts/log";
import { JOBS, type Job, type JobContext, type JobResult } from "@/lib/cron/jobs";
import { digestDueAt, digestReportDate, isDigestDue } from "@/lib/cron/schedule";
import { buildAlertReport, minimalAlertReport, type AlertReportInput } from "@/lib/email-report";
import { renderAlertEmail } from "@/lib/email-template";
import { quotaBytes } from "@/lib/format";
import { getComplianceDays } from "@/lib/stats";
import { localTimeInstant } from "@/lib/time";

/** Traffic inside the quota window on one local date. */
async function windowUsageOn(date: string, ctx: JobContext): Promise<number> {
  const { settings } = ctx;
  const from = localTimeInstant(date, "00:00", settings.timezone);
  const to = localTimeInstant(date, "00:00", settings.timezone, 1440);
  if (!from || !to) return 0;
  const days = await getComplianceDays({ from, to }, settings.timezone, settings.window_start, settings.window_end);
  return days.find((row) => row.day === date)?.used_bytes ?? 0;
}

async function run(ctx: JobContext): Promise<JobResult> {
  const { now, settings } = ctx;
  if (settings.digest === "off") return { status: "skipped", detail: "digest is off" };

  const last = await latestAlert("digest");
  if (!isDigestDue(settings.digest, now, last?.created_at ?? null, settings.billing_cycle_day, settings.timezone)) {
    return { status: "skipped", detail: last ? `last sent ${last.created_at.toISOString()}` : "not due" };
  }

  const dueAt = digestDueAt(settings.digest, now, settings.billing_cycle_day, settings.timezone) ?? now;
  const { date, asOf } = digestReportDate(settings.digest, dueAt, settings.billing_cycle_day, settings.timezone);

  const usedBytes = await windowUsageOn(date, ctx);
  const input: AlertReportInput = {
    settings,
    kind: "digest",
    digest: settings.digest,
    date,
    usedBytes,
    quotaBytes: quotaBytes(settings.quota_gb),
    threshold: null,
    now: asOf,
  };
  const report = await buildAlertReport(input).catch((err) => {
    console.warn("[cron] digest: could not build the full report", err);
    return minimalAlertReport(input);
  });

  const { status } = await dispatchAlert({
    kind: "digest",
    level: null,
    scopeKey: `digest:${date}`,
    to: settings.alert_email_to,
    email: renderAlertEmail(report),
    payload: { digest: settings.digest, date, today: report.today, cycle: report.cycle, week: report.week },
  });

  return { status: status === "failed" ? "failed" : "ok", detail: `digest ${status} for ${date}` };
}

export const digestJob: Job = { name: "digest", run };

JOBS.push(digestJob);
```

If plan 01 gave `AlertReportInput.threshold` a different optionality (for example `threshold?: number | null`), passing `threshold: null` still type-checks.

- [ ] **Step 2: Exercise it by hand**

With `pnpm dev` running and the summary set to Weekly on `/settings`:

```bash
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

Expected: the `digest` job reports `"digest sent for <yesterday>"` (never sent before, so the first tick sends) and the mail arrives with the "Scheduled summary" eyebrow. A second call reports `"last sent ..."` and sends nothing. `psql "$DATABASE_URL" -c "SELECT kind, scope_key, status FROM alerts WHERE kind = 'digest'"` shows one row.

- [ ] **Step 3: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass.

---

### Task 8: "Alert sent" on the dashboard

**Files:**
- Modify: `components/StatusCard.tsx`
- Modify: `app/[lang]/(app)/page.tsx`
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts` (`router` namespace)

**Interfaces:**
- Consumes: `latestAlert("link_stale", "link")` from plan 01's `lib/alerts/log.ts`.
- Produces: `StatusCard` prop `staleAlertAt?: string | null` (ISO instant of the newest `link_stale` alert, or null).

- [ ] **Step 1: Dictionary entries**

`en.ts`, inside `router:` after `noContactExplanation`:

```ts
    staleAlertSent: "Alert emailed at {time}.",
```

`ar.ts`, same place:

```ts
    staleAlertSent: "أُرسل تنبيه بالبريد في {time}.",
```

- [ ] **Step 2: Fetch it on the dashboard page**

In `app/[lang]/(app)/page.tsx`, import `latestAlert` from `@/lib/alerts/log`, and append it as the last entry of the existing `Promise.all` with `staleAlert` as the last destructured name, keeping any entries plans 03 and 04 appended (`latest`, `recent`). On the current file the result is:

```ts
  const [usage, history, session, cycle, staleAlert] = await Promise.all([
    getTodayUsage(settings),
    getDailyHistory(30, settings.timezone),
    getLatestSessionSummary(),
    getCycleUsage(settings.monthly_quota_gb, settings.billing_cycle_day, settings.timezone),
    latestAlert("link_stale", "link").catch(() => null),
  ]);
```

and pass it: `<StatusCard usage={usage} pollingEnabled={settings.polling_enabled} interfaceName={settings.wan_interface_name} session={session} staleAlertAt={staleAlert?.created_at.toISOString() ?? null} />`.

- [ ] **Step 3: Show it in `components/StatusCard.tsx`**

Add the prop to the component signature:

```ts
  /** When the newest "router has gone quiet" mail was sent, or null. */
  staleAlertAt?: string | null;
```

with `staleAlertAt = null` in the destructuring. Inside the `state.kind === "silent"` block, after the explanation `<dd>`, add:

```tsx
              {staleAlertAt &&
                usage.last_reading &&
                new Date(staleAlertAt) > new Date(usage.last_reading.recorded_at) && (
                  <dd className="text-xs text-muted">
                    {fill(d.router.staleAlertSent, { time: f.stamp(staleAlertAt, usage.timezone) })}
                  </dd>
                )}
```

The comparison keeps an old alert from a past outage off the card once readings have resumed.

- [ ] **Step 4: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all pass. With a `link_stale` row newer than the last reading in the dev database (from Task 5's manual run) the dashboard shows "Alert emailed at ..." under "No contact with the router".

---

### Task 9: Triggers and documentation

**Files:**
- Create: `vercel.ts`
- Create: `.github/workflows/tick.yml`
- Modify: `docker-compose.yml`
- Modify: `README.md` (new section "Scheduled jobs" after "## API"; a line in the "Project layout" section)
- Modify: `.env.local.example`
- Modify: `package.json` (dependency `@vercel/config`)

- [ ] **Step 1: Vercel cron**

Run: `pnpm add @vercel/config`

Create `vercel.ts`:

```ts
import type { VercelConfig } from "@vercel/config/v1";

/**
 * Vercel runs the scheduler tick. On the Hobby plan crons fire at most once a
 * day and at an hour Vercel picks, which serves the digest and the retention
 * job but not the stale-router alert; the GitHub Actions workflow in
 * .github/workflows/tick.yml covers that case on any plan.
 */
export const config: VercelConfig = {
  crons: [{ path: "/api/cron/tick", schedule: "*/5 * * * *" }],
};
```

Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when the project has an environment variable named exactly `CRON_SECRET`, which this project already requires for the router. No other setup.

- [ ] **Step 2: GitHub Actions trigger**

Create `.github/workflows/tick.yml`:

```yaml
# Calls the scheduler endpoint every five minutes. GitHub may delay a scheduled
# run by several minutes under load; that is fine, every job on the tick is
# idempotent. Set the repository secret CRON_SECRET (same value as on the
# server) and the repository variable TICK_URL, e.g.
# https://netmonitor.bilalnasr.com/api/cron/tick
name: tick

on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:

jobs:
  tick:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - name: Call /api/cron/tick
        run: |
          curl -fsS --max-time 60 \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ vars.TICK_URL }}"
```

- [ ] **Step 3: docker-compose sidecar**

In `docker-compose.yml`, after the `app` service and before `db`:

```yaml
  # Calls the scheduler endpoint once a minute. Only needed when nothing else
  # (Vercel Cron, GitHub Actions) does; harmless if both run.
  tick:
    image: curlimages/curl:8.10.1
    container_name: quota-tick
    restart: unless-stopped
    env_file:
      - .env.local
    depends_on:
      app:
        condition: service_healthy
    command:
      - sh
      - -c
      - 'while true; do curl -fsS -H "Authorization: Bearer $$CRON_SECRET" http://app:3000/api/cron/tick >/dev/null || echo "tick failed"; sleep 60; done'
```

(`$$CRON_SECRET` is how compose escapes a `$` so the container's shell expands it.)

- [ ] **Step 4: README section**

Insert after the "## API" section (before "### Ranges" is fine; place it as a new `## Scheduled jobs` heading right before `## Docker`):

```markdown
## Scheduled jobs

Two things cannot happen on the ingest path because they need to run when the
router is *not* pushing: noticing that it has gone quiet, and sending a summary
on a calendar. Both run from one endpoint:

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

Pick a trigger:

- **Vercel**: `vercel.ts` declares a cron every five minutes. Vercel sends the
  `CRON_SECRET` environment variable as the bearer token itself. On the Hobby
  plan crons run once a day, which is enough for the digest but not for the
  stale alert; add the GitHub trigger below.
- **GitHub Actions**: `.github/workflows/tick.yml` runs every five minutes. Set
  the repository secret `CRON_SECRET` and the repository variable `TICK_URL`
  (`https://netmonitor.bilalnasr.com/api/cron/tick`). Free, and independent of
  where the app is hosted.
- **Docker**: the `tick` service in `docker-compose.yml` calls the endpoint once
  a minute from inside the compose network.

Locally:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

The first tick after the summary is switched on sends one immediately, which
doubles as the check that the scheduler and the mail are wired up.
```

In the "Project layout" section add lines for `lib/cron/` ("the scheduler: job registry, tick runner, the stale and digest jobs, and the pure schedule arithmetic") and `lib/email-link-template.ts` ("the router-has-gone-quiet mail").

- [ ] **Step 5: `.env.local.example`**

After the `CRON_SECRET` line, extend the comment:

```
# Bearer token the router's quota-push script must send to /api/ingest, and the
# one the scheduler sends to /api/cron/tick (see README, "Scheduled jobs").
```

- [ ] **Step 6: Verify**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit && pnpm build`
Expected: all pass; the build succeeds with `vercel.ts` present (it is not imported by the app, only read by Vercel). `docker compose config` prints the `tick` service without errors.

---

## Self-review

**Spec coverage.** Contract 5: endpoint (Task 3), response shape (Task 3), `job_runs` (Task 1), `JOBS` registry with `stale` and `digest` (Tasks 5, 7), three triggers (Task 9). Contract 3 rows `stale_after_minutes` and `digest` (Task 1). Contract 9 `lib/cron/schedule.ts` exports `isDigestDue` and `isStale` (Task 2; `digestDueAt` and `digestReportDate` are additions, allowed by the roadmap). Stale mail and recovery mail (Tasks 4, 5). Digest kind on the report (Task 6) and the job (Task 7). Dashboard line (Task 8). README (Task 9).

**Placeholders.** The two placeholder files in Task 3 are explicitly replaced in Tasks 5 and 7 with full code; nothing else is deferred.

**Type consistency.** `JobContext { now; settings }` is what Tasks 5 and 7 destructure. `dispatchAlert` is called with `{ kind, level, scopeKey, to, email, payload }` everywhere and read as `{ status }`. `latestAlert` is called with `(kind, scopeKey?)` and its rows read as `created_at: Date` and `payload`. `AlertReportInput.kind` and `AlertReport.kind` both take `"digest"`; `digest?: "weekly" | "cycle"` matches `DigestKind` minus `"off"`, which the job guarantees by returning early on `"off"`. `DigestKind` is exported from `lib/settings.ts` and imported by `lib/cron/schedule.ts`.
