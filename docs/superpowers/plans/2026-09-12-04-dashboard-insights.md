# Dashboard Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the data the app already stores say more: a live throughput sparkline on the dashboard, one-click drill-down from a day bar to that day's hours, unusual-day flags on the daily charts, and a downtime summary plus calendar on the sessions page.

**Architecture:** Four pure modules (`lib/throughput.ts`, `lib/anomaly.ts`, `lib/outages.ts`, plus `formatRate` in `lib/format.ts`) hold every calculation and are unit-tested without a database. The only new query is `getRecentReadings` (last N minutes of raw rows). Pages compute in Server Components and hand serialisable arrays to small Client Components that draw with Recharts, following the conventions in `components/stats/chrome.tsx`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Recharts 3, Tailwind 4, vitest, pg-promise. No new dependencies.

**Spec:** `docs/superpowers/plans/2026-09-12-00-roadmap.md` (plan 04, shared contract 9). This plan is independent of plans 01 to 03 and 05 to 07.

## Global Constraints

- Every user-visible string is a key in `lib/i18n/dictionaries/en.ts` with an Arabic entry in `lib/i18n/dictionaries/ar.ts`; `lib/i18n.test.ts` fails otherwise.
- Charts follow `components/stats/chrome.tsx`: `chartMargin(dir)`, `valueAxisSide(dir)`, `AXIS`, `TooltipShell`/`TooltipRow`, colours only via CSS variables (`var(--series-1)`, `var(--status-warning)`, `var(--scale-1)`..`var(--scale-6)`, `var(--border)`, `var(--muted)`), `isAnimationActive={false}` on marks.
- Pages under `app/[lang]/(app)` start with `await connection()` and read the language with `getI18n()`; Client Components read it with `useI18n()`.
- Server Components pass only serialisable data (ISO strings, numbers) to Client Components. `Reading.recorded_at` is a `Date` and must be converted before crossing.
- Every page batches its queries in one `Promise.all` (Supabase round trips cost about 85 ms each).
- The user commits manually. No step commits. Each task ends when `pnpm test`, `pnpm lint` and `pnpm exec tsc --noEmit` pass.
- Verified from `lib/range.ts`: a custom range is `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`; a bare date in `to` is pushed to the following local midnight, so `from=D&to=D` is exactly the local day D (inclusive). `bucket=hour` is accepted as an override.

---

### Task 1: `formatRate` in `lib/format.ts`

**Files:**
- Modify: `lib/format.ts`
- Test: `lib/format.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `export function formatRate(bytesPerSecond: number): string` returning decimal bits per second: `"1.25 Gbit/s"`, `"12.4 Mbit/s"`, `"640 kbit/s"`, `"96 bit/s"`, `"-"` for non-finite.

- [ ] **Step 1: Write the failing test**

```ts
// lib/format.test.ts
import { describe, expect, test } from "vitest";
import { formatBytes, formatRate, quotaBytes } from "@/lib/format";

describe("formatRate", () => {
  test("writes bits per second in decimal units", () => {
    expect(formatRate(12)).toBe("96 bit/s");
    expect(formatRate(80_000)).toBe("640 kbit/s");
    expect(formatRate(1_550_000)).toBe("12.4 Mbit/s");
    expect(formatRate(156_250_000)).toBe("1.25 Gbit/s");
  });

  test("rounds instead of truncating", () => {
    // 1 562 500 B/s is 12.5 Mbit/s exactly; 1 568 750 is 12.55, shown as 12.6.
    expect(formatRate(1_562_500)).toBe("12.5 Mbit/s");
    expect(formatRate(1_568_750)).toBe("12.6 Mbit/s");
  });

  test("never shows a negative or a non-number", () => {
    expect(formatRate(-5)).toBe("0 bit/s");
    expect(formatRate(Number.NaN)).toBe("-");
    expect(formatRate(Number.POSITIVE_INFINITY)).toBe("-");
  });
});

describe("existing formatters keep working", () => {
  test("formatBytes and quotaBytes", () => {
    expect(formatBytes(1.5e9)).toBe("1.50 GB");
    expect(quotaBytes(8)).toBe(8_000_000_000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run lib/format.test.ts`
Expected: FAIL with `formatRate` is not exported / not a function.

- [ ] **Step 3: Implement**

Append to `lib/format.ts`:

```ts
/**
 * A throughput in bits per second, decimal units, the way ISPs quote a link.
 * Bytes in, because that is what the counters hold; a negative rate cannot
 * happen on a monotonic counter and is clamped rather than shown.
 */
export function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond)) return "-";
  const bits = Math.max(0, bytesPerSecond) * 8;
  if (bits >= 1e9) return `${(bits / 1e9).toFixed(2)} Gbit/s`;
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)} Mbit/s`;
  if (bits >= 1e3) return `${Math.round(bits / 1e3)} kbit/s`;
  return `${Math.round(bits)} bit/s`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run lib/format.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

---

### Task 2: `lib/throughput.ts`, rates from consecutive readings

**Files:**
- Create: `lib/throughput.ts`
- Test: `lib/throughput.test.ts`

**Interfaces:**
- Consumes: `Reading` from `lib/usage.ts` (`{ id: number; recorded_at: Date; tx_bytes: number; rx_bytes: number; total_bytes: number }`).
- Produces:

```ts
export interface RatePoint {
  /** ISO instant of the later reading of the pair. */
  at: string;
  bytes_per_second: number;
  tx_per_second: number;
  rx_per_second: number;
}
export function ratesFromReadings(readings: Reading[], maxGapSeconds?: number): RatePoint[];
```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/throughput.test.ts
import { describe, expect, test } from "vitest";
import { ratesFromReadings } from "@/lib/throughput";
import type { Reading } from "@/lib/usage";

function reading(id: number, iso: string, tx: number, rx: number): Reading {
  return { id, recorded_at: new Date(iso), tx_bytes: tx, rx_bytes: rx, total_bytes: tx + rx };
}

describe("ratesFromReadings", () => {
  test("divides each counter's growth by the seconds between readings", () => {
    const rates = ratesFromReadings([
      reading(1, "2026-09-12T10:00:00Z", 1_000, 10_000),
      reading(2, "2026-09-12T10:00:30Z", 1_300, 40_000),
      reading(3, "2026-09-12T10:01:00Z", 1_300, 100_000),
    ]);
    expect(rates).toEqual([
      { at: "2026-09-12T10:00:30.000Z", bytes_per_second: 1010, tx_per_second: 10, rx_per_second: 1000 },
      { at: "2026-09-12T10:01:00.000Z", bytes_per_second: 2000, tx_per_second: 0, rx_per_second: 2000 },
    ]);
  });

  test("skips the pair around a counter reset instead of inventing a rate", () => {
    const rates = ratesFromReadings([
      reading(1, "2026-09-12T10:00:00Z", 5_000, 90_000),
      reading(2, "2026-09-12T10:00:30Z", 100, 200), // interface restarted
      reading(3, "2026-09-12T10:01:00Z", 400, 3_200),
    ]);
    expect(rates).toEqual([
      { at: "2026-09-12T10:01:00.000Z", bytes_per_second: 110, tx_per_second: 10, rx_per_second: 100 },
    ]);
  });

  test("skips a gap longer than the limit, since it is an outage not an interval", () => {
    const rates = ratesFromReadings(
      [
        reading(1, "2026-09-12T10:00:00Z", 0, 0),
        reading(2, "2026-09-12T10:10:00Z", 0, 600_000), // 10 minutes
        reading(3, "2026-09-12T10:10:30Z", 0, 630_000),
      ],
      300,
    );
    expect(rates.map((r) => r.at)).toEqual(["2026-09-12T10:10:30.000Z"]);
    expect(rates[0].rx_per_second).toBe(1000);
  });

  test("a single reading, or none, gives no rate", () => {
    expect(ratesFromReadings([])).toEqual([]);
    expect(ratesFromReadings([reading(1, "2026-09-12T10:00:00Z", 1, 1)])).toEqual([]);
  });

  test("ignores a duplicate timestamp rather than dividing by zero", () => {
    const rates = ratesFromReadings([
      reading(1, "2026-09-12T10:00:00Z", 0, 0),
      reading(2, "2026-09-12T10:00:00Z", 0, 500),
      reading(3, "2026-09-12T10:00:10Z", 0, 1_500),
    ]);
    expect(rates).toEqual([
      { at: "2026-09-12T10:00:10.000Z", bytes_per_second: 100, tx_per_second: 0, rx_per_second: 100 },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run lib/throughput.test.ts`
Expected: FAIL, cannot find module `@/lib/throughput`.

- [ ] **Step 3: Implement**

```ts
// lib/throughput.ts
import type { Reading } from "@/lib/usage";

/**
 * Throughput between consecutive readings.
 *
 * Same delta rule as every aggregate in lib/stats.ts, with one difference: a
 * counter that went backwards means the interface restarted, and while the
 * totals treat the new value as traffic since the restart, a *rate* over that
 * pair would be meaningless, so the pair is skipped. A gap longer than
 * `maxGapSeconds` is an outage rather than a measurement interval and is
 * skipped for the same reason.
 */
export interface RatePoint {
  /** ISO instant of the later reading of the pair. */
  at: string;
  bytes_per_second: number;
  tx_per_second: number;
  rx_per_second: number;
}

export function ratesFromReadings(readings: Reading[], maxGapSeconds = 300): RatePoint[] {
  const out: RatePoint[] = [];
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const cur = readings[i];
    const gap = (cur.recorded_at.getTime() - prev.recorded_at.getTime()) / 1000;
    if (gap <= 0 || gap > maxGapSeconds) continue;
    if (cur.tx_bytes < prev.tx_bytes || cur.rx_bytes < prev.rx_bytes) continue;
    const tx = (cur.tx_bytes - prev.tx_bytes) / gap;
    const rx = (cur.rx_bytes - prev.rx_bytes) / gap;
    out.push({
      at: cur.recorded_at.toISOString(),
      bytes_per_second: tx + rx,
      tx_per_second: tx,
      rx_per_second: rx,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run lib/throughput.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

---

### Task 3: Live throughput card on the dashboard

**Files:**
- Modify: `lib/usage.ts` (add `getRecentReadings`)
- Create: `components/ThroughputCard.tsx`
- Modify: `app/[lang]/(app)/page.tsx`
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts` (new keys under `dashboard`)

**Interfaces:**
- Consumes: `ratesFromReadings`, `RatePoint` (Task 2); `formatRate` (Task 1); `chartMargin`, `valueAxisSide`, `AXIS`, `TooltipShell`, `TooltipRow` from `components/stats/chrome.tsx`.
- Produces:

```ts
// lib/usage.ts
export function getRecentReadings(minutes: number): Promise<Reading[]>; // ascending by (recorded_at, id)

// components/ThroughputCard.tsx  ("use client")
export function ThroughputCard(props: { rates: RatePoint[]; minutes: number; timezone: string }): JSX.Element;
```

- [ ] **Step 1: Add the query**

Append to `lib/usage.ts`:

```ts
/**
 * The raw readings of the last `minutes`, oldest first. Bounded by time rather
 * than by count so a router pushing every 30 seconds and one pushing every
 * minute both yield the same span on the throughput sparkline.
 */
export async function getRecentReadings(minutes: number): Promise<Reading[]> {
  return db.any<Reading>(
    `SELECT id, recorded_at, tx_bytes, rx_bytes, total_bytes
     FROM interface_readings
     WHERE recorded_at >= now() - make_interval(mins => $1)
     ORDER BY recorded_at ASC, id ASC`,
    [minutes],
  );
}
```

- [ ] **Step 2: Add the dictionary keys**

In `lib/i18n/dictionaries/en.ts`, inside `dashboard: { ... }` after `historyEmpty`:

```ts
    throughputHeading: "Live throughput",
    throughputHint: "last {minutes} minutes",
    throughputNow: "now",
    throughputEmpty: "Two readings inside the last {minutes} minutes are needed to measure a rate.",
```

In `lib/i18n/dictionaries/ar.ts`, inside `dashboard: { ... }` after `historyEmpty`:

```ts
    throughputHeading: "السرعة الحالية",
    throughputHint: "آخر {minutes} دقيقة",
    throughputNow: "الآن",
    throughputEmpty: "يلزم قراءتان خلال آخر {minutes} دقيقة لقياس السرعة.",
```

- [ ] **Step 3: Write the card**

```tsx
// components/ThroughputCard.tsx
"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { useI18n } from "@/components/I18nProvider";
import { chartMargin, TooltipRow, TooltipShell, valueAxisSide } from "@/components/stats/chrome";
import { formatRate } from "@/lib/format";
import { fill } from "@/lib/i18n";
import type { Formatters } from "@/lib/i18n/format";
import type { RatePoint } from "@/lib/throughput";

interface Row extends RatePoint {
  /** Megabits per second, the unit the axis is drawn in. */
  mbit: number;
}

function toRows(rates: RatePoint[]): Row[] {
  return rates.map((r) => ({ ...r, mbit: (r.bytes_per_second * 8) / 1e6 }));
}

function makeTooltip(f: Formatters, timezone: string, labels: { download: string; upload: string; total: string }) {
  return function ChartTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as Row;
    return (
      <TooltipShell title={f.clockWithSeconds(row.at, timezone)}>
        <TooltipRow label={labels.download} value={formatRate(row.rx_per_second)} color="var(--series-1)" />
        <TooltipRow label={labels.upload} value={formatRate(row.tx_per_second)} color="var(--series-2)" />
        <TooltipRow label={labels.total} value={formatRate(row.bytes_per_second)} />
      </TooltipShell>
    );
  };
}

/**
 * The last half hour of throughput as a sparkline, headlined by the newest
 * rate. Download is drawn as the filled area and upload as a thin line on top:
 * on a home link download dwarfs upload, so stacking them would hide the
 * upload entirely.
 */
export function ThroughputCard({
  rates,
  minutes,
  timezone,
}: {
  rates: RatePoint[];
  minutes: number;
  timezone: string;
}) {
  const { d, f, dir } = useI18n();
  const rows = toRows(rates);
  const latest = rows.length ? rows[rows.length - 1] : null;
  const ChartTooltip = makeTooltip(f, timezone, {
    download: d.common.download,
    upload: d.common.upload,
    total: d.common.total,
  });

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-muted">{d.dashboard.throughputHeading}</h2>
        <span className="text-xs text-muted">{fill(d.dashboard.throughputHint, { minutes })}</span>
      </div>

      {latest ? (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-semibold tabular-nums tracking-tight">
              {formatRate(latest.bytes_per_second)}
            </span>
            <span className="text-xs text-muted">
              {d.dashboard.throughputNow} · {d.common.download} {formatRate(latest.rx_per_second)} ·{" "}
              {d.common.upload} {formatRate(latest.tx_per_second)}
            </span>
          </div>
          <div className="mt-3 h-24 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={chartMargin(dir)}>
                <XAxis dataKey="at" hide />
                <YAxis
                  hide
                  orientation={valueAxisSide(dir)}
                  domain={[0, (max: number) => Math.max(max, 0.1)]}
                />
                <Tooltip content={ChartTooltip} cursor={{ stroke: "var(--border)" }} />
                <Area
                  type="monotone"
                  dataKey={(row: Row) => (row.rx_per_second * 8) / 1e6}
                  stroke="var(--series-1)"
                  fill="var(--series-1)"
                  fillOpacity={0.15}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey={(row: Row) => (row.tx_per_second * 8) / 1e6}
                  stroke="var(--series-2)"
                  fill="none"
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">{fill(d.dashboard.throughputEmpty, { minutes })}</p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Wire the dashboard**

In `app/[lang]/(app)/page.tsx`:

Add imports:

```ts
import { ThroughputCard } from "@/components/ThroughputCard";
import { ratesFromReadings } from "@/lib/throughput";
import { getDailyHistory, getRecentReadings, getTodayUsage } from "@/lib/usage";
```

(add `getRecentReadings` to the existing `@/lib/usage` import line; keep any names already on it, such as `getLatestReading` from plan 03).

Add a constant above the component:

```ts
/** Span of the throughput sparkline. Sixty pushes at the router's 30-second interval. */
const THROUGHPUT_MINUTES = 30;
```

Append `getRecentReadings(THROUGHPUT_MINUTES)` as the last entry of the existing `Promise.all`, and `recent` as the last name in its destructuring. Plans 02 and 03 append entries to the same call (`staleAlert`, `latest`); keep them, in their positions. On the current file the result is:

```ts
  const [usage, history, session, cycle, recent] = await Promise.all([
    getTodayUsage(settings),
    getDailyHistory(30, settings.timezone),
    getLatestSessionSummary(),
    getCycleUsage(settings.monthly_quota_gb, settings.billing_cycle_day, settings.timezone),
    getRecentReadings(THROUGHPUT_MINUTES),
  ]);
  const rates = ratesFromReadings(recent);
```

Insert between the closing `</div>` of the two-column grid and `<CycleGauge ...>`:

```tsx
      <ThroughputCard rates={rates} minutes={THROUGHPUT_MINUTES} timezone={settings.timezone} />
```

- [ ] **Step 5: Verify in the browser**

Run: `pnpm dev`, open `http://localhost:3000/en`. Expected: a "Live throughput" card with a headline rate and a sparkline; with fewer than two readings in the last 30 minutes it shows the empty sentence instead. Open `/ar` and confirm the value axis mirrors and the Arabic strings show.

- [ ] **Step 6: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green. If `tsc` rejects the `dataKey` function signature, replace both `dataKey={(row: Row) => ...}` with precomputed fields: add `rxMbit` and `txMbit` to `Row` in `toRows` and use `dataKey="rxMbit"` / `dataKey="txMbit"`.

---

### Task 4: Click a day bar to open that day by hour

**Files:**
- Modify: `components/HistoryChart.tsx`
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts` (`dashboard.drillHint`)

**Interfaces:**
- Consumes: `resolveRange` URL contract from `lib/range.ts`: `/{locale}/stats?range=custom&from={day}&to={day}&bucket=hour` shows local day `{day}` inclusive, bucketed by hour.
- Produces: no new exports. `HistoryChart` keeps its props.

- [ ] **Step 1: Dictionary keys**

`en.ts`, `dashboard`:

```ts
    drillHint: "Click a day to see it hour by hour.",
```

`ar.ts`, `dashboard`:

```ts
    drillHint: "انقر على يوم لعرضه ساعة بساعة.",
```

- [ ] **Step 2: Make the chart navigate**

In `components/HistoryChart.tsx`:

Add the import:

```ts
import { useRouter } from "next/navigation";
```

Change the destructuring at the top of `HistoryChart` to also take the locale, and create the router:

```ts
  const { d, dir, locale } = useI18n();
  const router = useRouter();
```

Add a handler inside the component, before `return`:

```ts
  /**
   * A bare date on both ends is the whole local day (lib/range.ts pushes `to`
   * to the next midnight), and an hourly bucket is what a single day reads
   * best in. The chart's own payload carries the day, so the click needs no
   * lookup.
   */
  function openDay(day: string) {
    router.push(`/${locale}/stats?range=custom&from=${day}&to=${day}&bucket=hour`);
  }
```

On the `<BarChart ...>` element add:

```tsx
              onClick={(state) => {
                const row = state?.activePayload?.[0]?.payload as DailyUsage | undefined;
                if (row?.day) openDay(row.day);
              }}
              style={{ cursor: "pointer" }}
```

Under the chart container `<div className="mt-4 h-64 w-full">...</div>`, add:

```tsx
      <p className="mt-2 text-xs text-muted">{d.dashboard.drillHint}</p>
```

- [ ] **Step 3: Verify**

Run: `pnpm dev`, click a bar on the dashboard. Expected: the statistics page opens with the subtitle showing that one day and the timeline bucketed by hour; the URL reads `?range=custom&from=2026-09-11&to=2026-09-11&bucket=hour`. If `tsc` reports that `state` has no `activePayload`, look at `node_modules/recharts/types/chart/types.d.ts` for the chart `onClick` parameter type and cast: `(state as { activePayload?: { payload: DailyUsage }[] } | null)?.activePayload?.[0]?.payload`.

- [ ] **Step 4: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

---

### Task 5: `lib/anomaly.ts`, unusual-day detection

**Files:**
- Create: `lib/anomaly.ts`
- Test: `lib/anomaly.test.ts`

**Interfaces:**
- Consumes: nothing beyond the input shape below. `DailyUsage` (lib/usage.ts) and `ComplianceDay` (lib/stats.ts) both satisfy it structurally.
- Produces:

```ts
export interface AnomalyDay { day: string; used_bytes: number; readings?: number }
export interface AnomalyFlag { day: string; used_bytes: number; baseline_bytes: number; ratio: number; z: number }
export interface AnomalyOptions { minDays: number; minRatio: number; minZ: number }
export const DEFAULT_ANOMALY_OPTIONS: AnomalyOptions; // { minDays: 7, minRatio: 2, minZ: 2 }
export function flagAnomalies(days: AnomalyDay[], opts?: Partial<AnomalyOptions>): AnomalyFlag[];
```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/anomaly.test.ts
import { describe, expect, test } from "vitest";
import { flagAnomalies } from "@/lib/anomaly";

function series(values: number[], start = "2026-09-01"): { day: string; used_bytes: number; readings: number }[] {
  const [y, m, d] = start.split("-").map(Number);
  return values.map((used, i) => ({
    day: new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10),
    used_bytes: used,
    readings: used === 0 ? 0 : 100,
  }));
}

describe("flagAnomalies", () => {
  test("flags a day far above the trailing median", () => {
    const days = series([4e9, 5e9, 4.5e9, 5.2e9, 4.8e9, 5.1e9, 4.9e9, 15e9]);
    const flags = flagAnomalies(days);
    expect(flags).toHaveLength(1);
    expect(flags[0].day).toBe("2026-09-08");
    expect(flags[0].used_bytes).toBe(15e9);
    expect(flags[0].baseline_bytes).toBe(4.9e9);
    expect(flags[0].ratio).toBeCloseTo(15 / 4.9, 3);
    expect(flags[0].z).toBeGreaterThan(2);
  });

  test("needs enough history before it says anything", () => {
    const days = series([4e9, 4e9, 4e9, 40e9]);
    expect(flagAnomalies(days)).toEqual([]);
    expect(flagAnomalies(days, { minDays: 3 })).toHaveLength(1);
  });

  test("a flat series has no anomalies", () => {
    expect(flagAnomalies(series(Array(14).fill(5e9)))).toEqual([]);
  });

  test("a big day that is still under twice the median is not flagged", () => {
    const days = series([5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 9e9]);
    expect(flagAnomalies(days)).toEqual([]);
  });

  test("days with no readings are neither judged nor used as history", () => {
    // Seven real days, then two silent days, then a spike: the silent days
    // must not drag the median down and must not be flagged themselves.
    const days = series([5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 0, 0, 12e9]);
    const flags = flagAnomalies(days);
    expect(flags.map((f) => f.day)).toEqual(["2026-09-10"]);
    expect(flags[0].baseline_bytes).toBe(5e9);
  });

  test("uses only the days before the one being judged", () => {
    // The spike must not be part of its own baseline.
    const days = series([5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 20e9, 5e9]);
    const flags = flagAnomalies(days);
    expect(flags.map((f) => f.day)).toEqual(["2026-09-08"]);
  });

  test("accepts the days in any order", () => {
    const days = series([5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 20e9]).reverse();
    expect(flagAnomalies(days).map((f) => f.day)).toEqual(["2026-09-08"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run lib/anomaly.test.ts`
Expected: FAIL, cannot find module `@/lib/anomaly`.

- [ ] **Step 3: Implement**

```ts
// lib/anomaly.ts
/**
 * Days whose traffic is out of line with the days before them.
 *
 * Judged against the median and the median absolute deviation of the earlier
 * days, because a home link's daily totals are skewed: one download day
 * would drag a mean and a standard deviation up and hide the next one. Two
 * tests must both pass, so a spike on a noisy series is not flagged merely
 * for being noisy, and a noticeable-but-ordinary day is not flagged merely
 * for standing out of a very flat week.
 */

export interface AnomalyDay {
  /** Local date, YYYY-MM-DD. */
  day: string;
  used_bytes: number;
  /** Readings that landed on the day. Absent means measured. */
  readings?: number;
}

export interface AnomalyFlag {
  day: string;
  used_bytes: number;
  /** The median of the earlier measured days. */
  baseline_bytes: number;
  /** used_bytes / baseline_bytes; Infinity when the baseline is zero. */
  ratio: number;
  /** Robust z-score (0.6745 * deviation / MAD); Infinity when MAD is zero and the day is above the median. */
  z: number;
}

export interface AnomalyOptions {
  /** Measured days that must precede a day before it is judged. */
  minDays: number;
  /** Day must be at least this many times the baseline. */
  minRatio: number;
  /** Day must be at least this many robust standard deviations above the baseline. */
  minZ: number;
}

export const DEFAULT_ANOMALY_OPTIONS: AnomalyOptions = { minDays: 7, minRatio: 2, minZ: 2 };

/** Consistency constant that scales MAD to a normal standard deviation. */
const MAD_TO_SIGMA = 0.6745;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function measured(day: AnomalyDay): boolean {
  return day.readings === undefined || day.readings > 0;
}

export function flagAnomalies(days: AnomalyDay[], opts: Partial<AnomalyOptions> = {}): AnomalyFlag[] {
  const o = { ...DEFAULT_ANOMALY_OPTIONS, ...opts };
  const ordered = [...days].filter(measured).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const flags: AnomalyFlag[] = [];

  for (let i = 0; i < ordered.length; i++) {
    if (i < o.minDays) continue;
    const history = ordered.slice(0, i).map((d) => d.used_bytes);
    const baseline = median(history);
    const mad = median(history.map((v) => Math.abs(v - baseline)));
    const used = ordered[i].used_bytes;
    const deviation = used - baseline;

    const ratio = baseline > 0 ? used / baseline : used > 0 ? Number.POSITIVE_INFINITY : 0;
    const z =
      mad > 0
        ? (MAD_TO_SIGMA * deviation) / mad
        : deviation > 0
          ? Number.POSITIVE_INFINITY
          : 0;

    if (ratio >= o.minRatio && z >= o.minZ) {
      flags.push({ day: ordered[i].day, used_bytes: used, baseline_bytes: baseline, ratio, z });
    }
  }
  return flags;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run lib/anomaly.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

---

### Task 6: Show unusual days on the dashboard and the statistics page

**Files:**
- Create: `components/AnomalyList.tsx`
- Modify: `components/HistoryChart.tsx` (flagged bars, list under the chart)
- Modify: `app/[lang]/(app)/page.tsx` (compute flags)
- Modify: `app/[lang]/(app)/stats/page.tsx` (list in the compliance section)
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts` (new `anomaly` namespace)

**Interfaces:**
- Consumes: `flagAnomalies`, `AnomalyFlag` (Task 5); `ComplianceSummary.days` is `ComplianceDay[]` with `{ day, used_bytes, notified }`.
- Produces:

```ts
// components/AnomalyList.tsx (Server Component)
export function AnomalyList(props: { flags: AnomalyFlag[] }): Promise<JSX.Element | null>;
// components/HistoryChart.tsx: new optional prop
//   anomalies?: string[]   (days to draw in the warning colour)
```

- [ ] **Step 1: Dictionary keys**

`en.ts`, new top-level namespace placed after `charts`:

```ts
  anomaly: {
    heading: "Unusual days",
    hint: "at least twice the usual day, judged against the days before it",
    line: "{day}: {used}, {ratio}× the usual {baseline}",
  },
```

`ar.ts`, same position:

```ts
  anomaly: {
    heading: "أيام غير معتادة",
    hint: "ضعف اليوم المعتاد على الأقل، مقارنةً بالأيام التي سبقته",
    line: "{day}: {used}، {ratio}× المعتاد {baseline}",
  },
```

- [ ] **Step 2: The list component**

```tsx
// components/AnomalyList.tsx
import type { AnomalyFlag } from "@/lib/anomaly";
import { formatBytes } from "@/lib/format";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

/**
 * The flagged days, one line each, newest first. Renders nothing when there is
 * nothing to say: an empty "unusual days" box would itself be the odd thing
 * on the page.
 */
export async function AnomalyList({ flags }: { flags: AnomalyFlag[] }) {
  if (flags.length === 0) return null;
  const { d } = await getI18n();
  const newestFirst = [...flags].sort((a, b) => (a.day < b.day ? 1 : -1));
  return (
    <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium">{d.anomaly.heading}</span>
        <span className="text-xs text-muted">{d.anomaly.hint}</span>
      </div>
      <ul className="mt-1 space-y-0.5 tabular-nums">
        {newestFirst.map((f) => (
          <li key={f.day}>
            {fill(d.anomaly.line, {
              day: f.day,
              used: formatBytes(f.used_bytes),
              ratio: Number.isFinite(f.ratio) ? f.ratio.toFixed(1) : "∞",
              baseline: formatBytes(f.baseline_bytes),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Colour the flagged bars**

In `components/HistoryChart.tsx`:

Add `Cell` to the recharts import list (it sits alphabetically after `CartesianGrid`).

Extend `Props`:

```ts
  /** Days (YYYY-MM-DD) flagged as unusual; drawn in the warning colour. */
  anomalies?: string[];
```

Change the signature to `export function HistoryChart({ history, quotaGb, today, days = 30, anomalies = [] }: Props)` and add before `return`:

```ts
  const flagged = new Set(anomalies);
```

Replace the self-closing `<Bar ... fill="var(--series-1)" />` with:

```tsx
              <Bar dataKey="gb" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
                {/* Colour marks state, not identity: a flagged day is out of
                    line with the days before it, and the list under the chart
                    says by how much, so the colour never stands alone. */}
                {data.map((row) => (
                  <Cell
                    key={row.day}
                    fill={flagged.has(row.day) ? "var(--status-warning)" : "var(--series-1)"}
                  />
                ))}
              </Bar>
```

Keep the existing comment about "One colour" but reword it to: `{/* All bars share one hue because they are whole days while the quota governs only the window; the warning colour is reserved for flagged days. */}`.

- [ ] **Step 4: Dashboard wiring**

In `app/[lang]/(app)/page.tsx` add imports:

```ts
import { AnomalyList } from "@/components/AnomalyList";
import { flagAnomalies } from "@/lib/anomaly";
```

After `const rates = ratesFromReadings(recent);` add:

```ts
  const anomalies = flagAnomalies(history);
```

Change the chart line to:

```tsx
      <HistoryChart
        history={history}
        quotaGb={settings.quota_gb}
        today={usage.date}
        anomalies={anomalies.map((a) => a.day)}
      />
      <AnomalyList flags={anomalies} />
```

- [ ] **Step 5: Statistics page wiring**

In `app/[lang]/(app)/stats/page.tsx` add imports:

```ts
import { AnomalyList } from "@/components/AnomalyList";
import { flagAnomalies } from "@/lib/anomaly";
```

After `const report = await buildStatsReport(settings, range, d);` add:

```ts
  // Judged on window-only usage, which is what the compliance chart draws, so a
  // flagged bar and a flagged line describe the same number.
  const anomalies = flagAnomalies(report.compliance.days);
```

Directly after the `<Card title={d.stats.dailyUsageInWindow} ...>...</Card>` block add:

```tsx
      <AnomalyList flags={anomalies} />
```

- [ ] **Step 6: Verify**

Run: `pnpm dev`. On the dashboard, temporarily pass `anomalies={[usage.date]}` to confirm the bar turns amber, then revert. With real data the list appears only when a day is at least twice the trailing median. On `/en/stats?range=last_30d` the list sits under the compliance chart when applicable.

- [ ] **Step 7: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

---

### Task 7: `lib/outages.ts`, outages from sessions and downtime per day

**Files:**
- Create: `lib/outages.ts`
- Test: `lib/outages.test.ts`

**Interfaces:**
- Consumes: `SessionSummary` from `lib/sessions.ts` (`{ id, started_at: string, ended_at: string | null, downtime_before_seconds: number | null, ... }`), `localParts` and `localTimeInstant` from `lib/time.ts`.
- Produces:

```ts
export interface Outage {
  from: string;                    // ISO
  to: string;                      // ISO, exclusive
  seconds: number;
  ended_session_id: number | null; // null when the session that ended lies before the listed ones
  next_session_id: number | null;  // null when the link is still down at the end of the range
}
export interface DayDowntime { day: string; seconds: number; outages: number }
export function outagesFromSessions(sessions: SessionSummary[], range: { from: Date | null; to: Date }): Outage[];
export function downtimeByDay(outages: Outage[], timezone: string): DayDowntime[];
```

Note for the roadmap: `ended_session_id` is nullable here, unlike the roadmap sketch, because `getSessions` lists only sessions overlapping the range and the gap before the first listed session comes from its `downtime_before_seconds`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/outages.test.ts
import { describe, expect, test } from "vitest";
import { downtimeByDay, outagesFromSessions, type Outage } from "@/lib/outages";
import type { SessionSummary } from "@/lib/sessions";

function session(
  id: number,
  started: string,
  ended: string | null,
  downtimeBefore: number | null = null,
): SessionSummary {
  return {
    id,
    session_key: `s${id}`,
    interface_name: "pppoe-out1",
    started_at: new Date(started).toISOString(),
    ended_at: ended ? new Date(ended).toISOString() : null,
    end_reason: ended ? "reported" : null,
    last_seen_at: new Date(ended ?? started).toISOString(),
    open: ended === null,
    uptime_seconds: 0,
    seconds_since_seen: 0,
    downtime_before_seconds: downtimeBefore,
    tx_bytes: 0,
    rx_bytes: 0,
    total_bytes: 0,
    samples: 1,
  };
}

const range = { from: new Date("2026-09-10T00:00:00Z"), to: new Date("2026-09-12T00:00:00Z") };

describe("outagesFromSessions", () => {
  test("the gap between one session's end and the next one's start is an outage", () => {
    const outages = outagesFromSessions(
      [
        session(2, "2026-09-10T12:10:00Z", null),
        session(1, "2026-09-10T08:00:00Z", "2026-09-10T12:00:00Z"),
      ],
      range,
    );
    expect(outages).toEqual<Outage[]>([
      {
        from: "2026-09-10T12:00:00.000Z",
        to: "2026-09-10T12:10:00.000Z",
        seconds: 600,
        ended_session_id: 1,
        next_session_id: 2,
      },
    ]);
  });

  test("a closed newest session means the link is still down until the end of the range", () => {
    const outages = outagesFromSessions([session(1, "2026-09-11T08:00:00Z", "2026-09-11T20:00:00Z")], range);
    expect(outages).toEqual<Outage[]>([
      {
        from: "2026-09-11T20:00:00.000Z",
        to: "2026-09-12T00:00:00.000Z",
        seconds: 14_400,
        ended_session_id: 1,
        next_session_id: null,
      },
    ]);
  });

  test("the gap before the first listed session comes from its downtime_before_seconds", () => {
    const outages = outagesFromSessions([session(5, "2026-09-10T01:00:00Z", null, 7_200)], range);
    expect(outages).toEqual<Outage[]>([
      {
        from: "2026-09-10T00:00:00.000Z", // clipped: the gap began at 23:00 the day before
        to: "2026-09-10T01:00:00.000Z",
        seconds: 3_600,
        ended_session_id: null,
        next_session_id: 5,
      },
    ]);
  });

  test("outages are clipped to the range and dropped when nothing is left", () => {
    const outages = outagesFromSessions(
      [
        session(2, "2026-09-13T00:00:00Z", null), // starts after the range
        session(1, "2026-09-09T00:00:00Z", "2026-09-11T23:00:00Z"),
      ],
      range,
    );
    expect(outages).toEqual<Outage[]>([
      {
        from: "2026-09-11T23:00:00.000Z",
        to: "2026-09-12T00:00:00.000Z",
        seconds: 3_600,
        ended_session_id: 1,
        next_session_id: 2,
      },
    ]);
    // A gap entirely outside the range is not an outage of the range.
    expect(
      outagesFromSessions(
        [session(2, "2026-09-09T02:00:00Z", null), session(1, "2026-09-09T00:00:00Z", "2026-09-09T01:00:00Z")],
        range,
      ),
    ).toEqual([]);
  });

  test("no sessions, or one open session with no gap before it, means no outages", () => {
    expect(outagesFromSessions([], range)).toEqual([]);
    expect(outagesFromSessions([session(1, "2026-09-10T00:00:00Z", null, 0)], range)).toEqual([]);
    expect(outagesFromSessions([session(1, "2026-09-10T00:00:00Z", null, null)], range)).toEqual([]);
  });

  test("an open-ended range still works", () => {
    const outages = outagesFromSessions(
      [session(2, "2026-09-10T12:10:00Z", null), session(1, "2026-09-10T08:00:00Z", "2026-09-10T12:00:00Z")],
      { from: null, to: range.to },
    );
    expect(outages).toHaveLength(1);
    expect(outages[0].seconds).toBe(600);
  });
});

describe("downtimeByDay", () => {
  test("splits an outage across local midnight", () => {
    // 23:30 to 00:30 Beirut time (UTC+3 in September): 30 minutes on each day.
    const byDay = downtimeByDay(
      [
        {
          from: "2026-09-10T20:30:00.000Z",
          to: "2026-09-10T21:30:00.000Z",
          seconds: 3_600,
          ended_session_id: 1,
          next_session_id: 2,
        },
      ],
      "Asia/Beirut",
    );
    expect(byDay).toEqual([
      { day: "2026-09-10", seconds: 1_800, outages: 1 },
      { day: "2026-09-11", seconds: 1_800, outages: 1 },
    ]);
  });

  test("adds up several outages on one day and counts each once", () => {
    const outage = (from: string, to: string): Outage => ({
      from,
      to,
      seconds: (new Date(to).getTime() - new Date(from).getTime()) / 1000,
      ended_session_id: 1,
      next_session_id: 2,
    });
    const byDay = downtimeByDay(
      [outage("2026-09-10T08:00:00Z", "2026-09-10T08:05:00Z"), outage("2026-09-10T15:00:00Z", "2026-09-10T15:10:00Z")],
      "UTC",
    );
    expect(byDay).toEqual([{ day: "2026-09-10", seconds: 900, outages: 2 }]);
  });

  test("a multi-day outage touches every day it spans", () => {
    const byDay = downtimeByDay(
      [
        {
          from: "2026-09-10T12:00:00.000Z",
          to: "2026-09-12T06:00:00.000Z",
          seconds: 151_200,
          ended_session_id: 1,
          next_session_id: null,
        },
      ],
      "UTC",
    );
    expect(byDay).toEqual([
      { day: "2026-09-10", seconds: 43_200, outages: 1 },
      { day: "2026-09-11", seconds: 86_400, outages: 1 },
      { day: "2026-09-12", seconds: 21_600, outages: 1 },
    ]);
  });

  test("no outages, no rows", () => {
    expect(downtimeByDay([], "UTC")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run lib/outages.test.ts`
Expected: FAIL, cannot find module `@/lib/outages`.

- [ ] **Step 3: Implement**

```ts
// lib/outages.ts
import type { SessionSummary } from "@/lib/sessions";
import { localParts, localTimeInstant } from "@/lib/time";

/**
 * Periods the link was down, derived from the sessions table.
 *
 * A session ends when the router reports the link down (or when a reconnect
 * is detected), and the next one starts at the router's link-up time, so the
 * space between them is the outage. `getSessions` lists only sessions that
 * overlap the range, which leaves two edges to handle: the gap before the
 * first listed session is known only through its `downtime_before_seconds`,
 * and a closed newest session means the link has not come back yet.
 */

export interface Outage {
  /** ISO instant the link went down (clipped to the range). */
  from: string;
  /** ISO instant the link came back, or the end of the range while it is still down. */
  to: string;
  seconds: number;
  /** The session that ended; null when it lies before the listed sessions. */
  ended_session_id: number | null;
  /** The session that followed; null while the link is still down. */
  next_session_id: number | null;
}

export interface DayDowntime {
  /** Local date, YYYY-MM-DD. */
  day: string;
  seconds: number;
  /** Outages touching the day; one outage spanning midnight counts on both days. */
  outages: number;
}

function clip(
  fromMs: number,
  toMs: number,
  range: { from: Date | null; to: Date },
): { from: number; to: number } | null {
  const lo = range.from ? Math.max(fromMs, range.from.getTime()) : fromMs;
  const hi = Math.min(toMs, range.to.getTime());
  return hi > lo ? { from: lo, to: hi } : null;
}

function toOutage(
  span: { from: number; to: number },
  endedSessionId: number | null,
  nextSessionId: number | null,
): Outage {
  return {
    from: new Date(span.from).toISOString(),
    to: new Date(span.to).toISOString(),
    seconds: Math.round((span.to - span.from) / 1000),
    ended_session_id: endedSessionId,
    next_session_id: nextSessionId,
  };
}

export function outagesFromSessions(
  sessions: SessionSummary[],
  range: { from: Date | null; to: Date },
): Outage[] {
  const ordered = [...sessions].sort((a, b) => {
    const byStart = a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0;
    return byStart !== 0 ? byStart : a.id - b.id;
  });
  if (ordered.length === 0) return [];

  const out: Outage[] = [];

  // The gap before the first listed session: its predecessor is not in the list.
  const first = ordered[0];
  if (first.downtime_before_seconds && first.downtime_before_seconds > 0) {
    const startMs = new Date(first.started_at).getTime();
    const span = clip(startMs - first.downtime_before_seconds * 1000, startMs, range);
    if (span) out.push(toOutage(span, null, first.id));
  }

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (!prev.ended_at) continue; // an open session has no successor gap
    const span = clip(new Date(prev.ended_at).getTime(), new Date(cur.started_at).getTime(), range);
    if (span) out.push(toOutage(span, prev.id, cur.id));
  }

  // A closed newest session: the link is still down at the end of the range.
  const last = ordered[ordered.length - 1];
  if (last.ended_at) {
    const span = clip(new Date(last.ended_at).getTime(), range.to.getTime(), range);
    if (span) out.push(toOutage(span, last.id, null));
  }

  return out;
}

/** Guard against a pathological range: nothing on these pages spans years. */
const MAX_DAYS_PER_OUTAGE = 400;

export function downtimeByDay(outages: Outage[], timezone: string): DayDowntime[] {
  const byDay = new Map<string, DayDowntime>();

  for (const outage of outages) {
    let cursor = new Date(outage.from).getTime();
    const end = new Date(outage.to).getTime();
    let guard = 0;

    while (cursor < end && guard++ < MAX_DAYS_PER_OUTAGE) {
      const day = localParts(new Date(cursor), timezone).date;
      // Local midnight after `day`; localTimeInstant shifts the calendar day
      // by the minute offset, so 1440 lands on the next day's 00:00.
      const nextMidnight = localTimeInstant(day, "00:00", timezone, 1440);
      const sliceEnd = Math.min(end, nextMidnight ? nextMidnight.getTime() : end);
      const seconds = Math.round((sliceEnd - cursor) / 1000);

      const row = byDay.get(day) ?? { day, seconds: 0, outages: 0 };
      row.seconds += seconds;
      row.outages += 1;
      byDay.set(day, row);

      if (sliceEnd <= cursor) break;
      cursor = sliceEnd;
    }
  }

  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run lib/outages.test.ts`
Expected: PASS (10 tests). If the midnight-split test fails on the Beirut boundary, check `localTimeInstant("2026-09-10", "00:00", "Asia/Beirut", 1440)` returns `2026-09-10T21:00:00.000Z` (Beirut is UTC+3 on that date).

- [ ] **Step 5: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

---

### Task 8: Downtime tiles and calendar on the sessions page

**Files:**
- Create: `components/OutageSummary.tsx`
- Create: `components/OutageCalendar.tsx`
- Modify: `app/[lang]/(app)/sessions/page.tsx`
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts` (new keys under `sessions`)

**Interfaces:**
- Consumes: `outagesFromSessions`, `downtimeByDay`, `Outage`, `DayDowntime` (Task 7); `StatTiles`, `Tile` from `components/stats/chrome.tsx`; `getI18n` (server), `localParts` (lib/time.ts).
- Produces:

```ts
// Server Components
export function OutageSummary(props: { outages: Outage[]; timezone: string }): Promise<JSX.Element>;
export function OutageCalendar(props: { byDay: DayDowntime[]; from: Date | null; to: Date; timezone: string }): Promise<JSX.Element>;
export const CALENDAR_MAX_DAYS = 92;
```

- [ ] **Step 1: Dictionary keys**

`en.ts`, inside `sessions: { ... }` after `upBytes`:

```ts
    downtimeHeading: "Downtime",
    totalDowntime: "Total downtime",
    downtimeShare: "{percent}% of the range",
    longestOutage: "Longest outage",
    outageEndedAt: "back at {time}",
    outageOngoing: "still down",
    outagesCount: plural({
      one: "{count} outage",
      other: "{count} outages",
    }),
    outagesHint: "gaps between one session and the next",
    noOutages: "No outages in this range.",
    calendarHeading: "Downtime by day",
    calendarHint: "darker means longer offline",
    calendarCell: "{day}: offline {duration}",
    calendarCellNone: "{day}: no outages",
    calendarTooLong: "Choose a range of {max} days or fewer to see the calendar.",
```

`ar.ts`, same position:

```ts
    downtimeHeading: "الانقطاع",
    totalDowntime: "إجمالي الانقطاع",
    downtimeShare: "{percent}% من المدة",
    longestOutage: "أطول انقطاع",
    outageEndedAt: "عاد في {time}",
    outageOngoing: "ما زال منقطعاً",
    outagesCount: plural({
      zero: "لا انقطاعات",
      one: "انقطاع واحد",
      two: "انقطاعان",
      few: "{count} انقطاعات",
      many: "{count} انقطاعاً",
      other: "{count} انقطاع",
    }),
    outagesHint: "الفجوات بين جلسة والتي تليها",
    noOutages: "لا انقطاعات في هذه المدة.",
    calendarHeading: "الانقطاع حسب اليوم",
    calendarHint: "الأغمق يعني انقطاعاً أطول",
    calendarCell: "{day}: منقطع {duration}",
    calendarCellNone: "{day}: لا انقطاعات",
    calendarTooLong: "اختر مدة {max} يوماً أو أقل لعرض التقويم.",
```

- [ ] **Step 2: The summary tiles**

```tsx
// components/OutageSummary.tsx
import { StatTiles, type Tile } from "@/components/stats/chrome";
import { fill, plural } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { Outage } from "@/lib/outages";

/**
 * Three figures for the range: how long the link was down in total, the
 * single longest outage, and how many there were. Availability already has
 * a tile on the statistics page, so it is not repeated here.
 */
export async function OutageSummary({
  outages,
  rangeSeconds,
  timezone,
}: {
  outages: Outage[];
  /** Length of the range being shown, for the share figure; null for all time. */
  rangeSeconds: number | null;
  timezone: string;
}) {
  const { locale, d, f } = await getI18n();
  const s = d.sessions;

  const total = outages.reduce((sum, o) => sum + o.seconds, 0);
  const longest = outages.reduce<Outage | null>((best, o) => (best && best.seconds >= o.seconds ? best : o), null);
  const share = rangeSeconds && rangeSeconds > 0 ? (total / rangeSeconds) * 100 : null;

  const tiles: Tile[] = [
    {
      label: s.totalDowntime,
      value: f.duration(total),
      hint: share !== null ? fill(s.downtimeShare, { percent: share.toFixed(share >= 10 ? 0 : 1) }) : undefined,
      tone: total === 0 ? "good" : share !== null && share >= 5 ? "critical" : "warning",
    },
    {
      label: s.longestOutage,
      value: longest ? f.duration(longest.seconds) : d.common.empty,
      hint: longest
        ? longest.next_session_id === null
          ? s.outageOngoing
          : fill(s.outageEndedAt, { time: f.stamp(longest.to, timezone) })
        : s.noOutages,
    },
    {
      label: s.downtimeHeading,
      value: plural(locale, s.outagesCount, outages.length),
      hint: s.outagesHint,
    },
  ];

  return <StatTiles tiles={tiles} columns={3} />;
}
```

- [ ] **Step 3: The calendar**

```tsx
// components/OutageCalendar.tsx
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { DayDowntime } from "@/lib/outages";
import { localParts } from "@/lib/time";

/** Beyond this many days the cells are too small to read; the tiles still show. */
export const CALENDAR_MAX_DAYS = 92;

/**
 * Six steps of the sequential ramp from app/globals.css, chosen by how long
 * the link was down: the same bands the session-length chart uses, so a
 * reader who knows one knows the other.
 */
function level(seconds: number): number {
  if (seconds <= 0) return 0;
  if (seconds < 300) return 1;
  if (seconds < 1800) return 2;
  if (seconds < 7200) return 3;
  if (seconds < 21600) return 4;
  if (seconds < 86400) return 5;
  return 6;
}

/** Every local date from `from` up to but not including the day after `to`. */
function daysBetween(from: Date, to: Date, timezone: string): string[] {
  const out: string[] = [];
  const first = localParts(from, timezone).date;
  const last = localParts(new Date(to.getTime() - 1), timezone).date;
  const [y, m, d] = first.split("-").map(Number);
  for (let i = 0; i <= CALENDAR_MAX_DAYS; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    out.push(day);
    if (day >= last) break;
  }
  return out;
}

export async function OutageCalendar({
  byDay,
  from,
  to,
  timezone,
}: {
  byDay: DayDowntime[];
  from: Date | null;
  to: Date;
  timezone: string;
}) {
  const { d, f } = await getI18n();
  const s = d.sessions;

  const days = from ? daysBetween(from, to, timezone) : [];
  const tooLong = !from || days.length > CALENDAR_MAX_DAYS;
  const bySeconds = new Map(byDay.map((row) => [row.day, row]));

  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-muted">{s.calendarHeading}</h2>
        <span className="text-xs text-muted">{s.calendarHint}</span>
      </div>
      {tooLong ? (
        <p className="mt-4 text-sm text-muted">{fill(s.calendarTooLong, { max: CALENDAR_MAX_DAYS })}</p>
      ) : (
        // The grid runs oldest to newest in reading order; dir="ltr" keeps a
        // time axis from reversing on the Arabic page (see chrome.tsx).
        <ul dir="ltr" className="mt-4 grid grid-cols-7 gap-1 sm:grid-cols-14 lg:grid-cols-[repeat(23,minmax(0,1fr))]">
          {days.map((day) => {
            const row = bySeconds.get(day);
            const seconds = row?.seconds ?? 0;
            const lvl = level(seconds);
            const title = seconds > 0
              ? fill(s.calendarCell, { day, duration: f.duration(seconds) })
              : fill(s.calendarCellNone, { day });
            return (
              <li
                key={day}
                title={title}
                aria-label={title}
                className="aspect-square rounded-[3px] border border-border text-[9px] leading-none text-muted"
                style={{ background: lvl === 0 ? "var(--surface)" : `var(--scale-${lvl})` }}
              >
                <span className="sr-only">{title}</span>
                <span aria-hidden className="block p-0.5 tabular-nums">
                  {day.slice(8)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Wire the sessions page**

In `app/[lang]/(app)/sessions/page.tsx` add imports:

```ts
import { OutageCalendar } from "@/components/OutageCalendar";
import { OutageSummary } from "@/components/OutageSummary";
import { downtimeByDay, outagesFromSessions } from "@/lib/outages";
```

After the `Promise.all` that yields `sessions` and `totals`, add:

```ts
  // Derived from the sessions already fetched, so the report costs no extra
  // round trip. It is bounded by LIMIT like the table: on a range with more
  // than LIMIT sessions the oldest gaps are not shown, which the footnote says.
  const outages = outagesFromSessions(sessions, window);
  const byDay = downtimeByDay(outages, settings.timezone);
  const rangeSeconds = range.from ? Math.round((range.to.getTime() - range.from.getTime()) / 1000) : null;
```

Between `<SessionTotalsCards totals={totals} />` and `<SessionsTable ...>` insert:

```tsx
      <h2 className="pt-2 text-sm font-semibold tracking-tight">{d.sessions.downtimeHeading}</h2>
      <OutageSummary outages={outages} rangeSeconds={rangeSeconds} timezone={settings.timezone} />
      <OutageCalendar byDay={byDay} from={range.from} to={range.to} timezone={settings.timezone} />
```

- [ ] **Step 5: Verify**

Run: `pnpm dev`, open `/en/sessions` (default last 30 days). Expected: three tiles under the totals, then a 30-cell calendar with darker cells on days the link was down; hovering a cell shows the day and duration. Switch to `all_time`: the tiles show, the calendar shows the "choose a range" sentence. Open `/ar/sessions`: Arabic labels, the calendar still runs left to right.

Note the Tailwind class `sm:grid-cols-14` is not a default step; if the build warns or it has no effect, replace it with `sm:grid-cols-[repeat(14,minmax(0,1fr))]`.

- [ ] **Step 6: Full check**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green. The i18n parity test must pass with the new `sessions.*` and `anomaly.*` keys in both languages.

---

## Self-review notes

- Spec coverage: live throughput (Tasks 1 to 3), drill-down (Task 4), anomaly flags on both pages (Tasks 5 and 6), outage report with tiles and calendar on `/sessions` (Tasks 7 and 8). Nothing in plan 04's scope is left out; "downtime this cycle" on the dashboard was explicitly kept out.
- Type consistency: `RatePoint` fields used by `ThroughputCard` match Task 2; `AnomalyFlag` fields used by `AnomalyList` match Task 5; `Outage` and `DayDowntime` used by Task 8 match Task 7; `Tile` and `StatTiles` come from `components/stats/chrome.tsx` unchanged.
- The one deviation from the roadmap sketch: `Outage.ended_session_id` is `number | null`, for the gap before the first listed session.
