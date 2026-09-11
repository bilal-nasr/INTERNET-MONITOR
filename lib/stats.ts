/**
 * Every statistic the stored data supports, aggregated in Postgres.
 *
 * All traffic figures derive from one rule, shared by every query in this file:
 * usage between two consecutive readings is the growth of the counter, except
 * when the counter went backwards, in which case the interface restarted and
 * the whole new value is the traffic since that restart. Deltas are taken
 * within a single interface, because two interfaces have unrelated counter
 * streams and chaining them would read as one enormous transfer.
 *
 * The router pushes every few seconds, so a month of history is hundreds of
 * thousands of rows. Nothing here ever ships raw readings to the application.
 */

import { cycleBounds, cycleProgress, projectCycleUsage } from "@/lib/billing";
import { db } from "@/lib/db";
import { quotaBytes } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n";
import type { BucketUnit } from "@/lib/range";
import { windowSeconds } from "@/lib/time";

/**
 * Readings just before the range, so the first reading inside it has a
 * predecessor to measure against. Deltas from this lead-in are discarded.
 */
const LOOKBACK = "INTERVAL '1 hour'";

/**
 * A gap longer than this is an outage, not a measurement interval. It is left
 * out of the time base for average throughput, which would otherwise collapse
 * towards zero after every disconnection.
 */
const MAX_SAMPLE_GAP_SECONDS = 3600;

export interface RangeParams {
  from: Date | null;
  to: Date;
}

/**
 * Per-reading deltas over the range, as two CTEs named `r` and `d`. Every query
 * below opens with this and then aggregates `d`.
 *
 * `${from}` / `${to}` are pg-promise named parameters: the `\$` keeps them out
 * of JavaScript interpolation so the driver, not this file, does the escaping.
 */
const DELTAS = `
  r AS (
    SELECT recorded_at,
           total_bytes, tx_bytes, rx_bytes,
           LAG(total_bytes) OVER w AS prev_total,
           LAG(tx_bytes)    OVER w AS prev_tx,
           LAG(rx_bytes)    OVER w AS prev_rx,
           LAG(recorded_at) OVER w AS prev_at
    FROM interface_readings
    WHERE (\${from} IS NULL OR recorded_at >= \${from}::timestamptz - ${LOOKBACK})
      AND recorded_at < \${to}::timestamptz
    WINDOW w AS (PARTITION BY interface_name ORDER BY recorded_at, id)
  ),
  d AS (
    SELECT recorded_at,
           CASE WHEN prev_total IS NULL THEN 0
                WHEN total_bytes >= prev_total THEN total_bytes - prev_total
                ELSE total_bytes END AS delta,
           CASE WHEN prev_tx IS NULL THEN 0
                WHEN tx_bytes >= prev_tx THEN tx_bytes - prev_tx
                ELSE tx_bytes END AS tx_delta,
           CASE WHEN prev_rx IS NULL THEN 0
                WHEN rx_bytes >= prev_rx THEN rx_bytes - prev_rx
                ELSE rx_bytes END AS rx_delta,
           GREATEST(EXTRACT(EPOCH FROM (recorded_at - prev_at)), 0) AS gap_seconds
    FROM r
    WHERE (\${from} IS NULL OR recorded_at >= \${from}::timestamptz)
  )`;

// ------------------------------------------------------------- totals ----

export interface RangeSummary {
  readings: number;
  total_bytes: number;
  tx_bytes: number;
  rx_bytes: number;
  first_reading_at: string | null;
  last_reading_at: string | null;
  /** Seconds actually covered by samples, excluding outages. */
  measured_seconds: number;
  peak_bytes_per_second: number;
  avg_bytes_per_second: number;
}

interface SummaryRow {
  readings: number;
  total_bytes: number;
  tx_bytes: number;
  rx_bytes: number;
  first_reading_at: Date | null;
  last_reading_at: Date | null;
  measured_seconds: number;
  peak_bytes_per_second: number;
}

export async function getRangeSummary({ from, to }: RangeParams): Promise<RangeSummary> {
  const row = await db.one<SummaryRow>(
    `WITH ${DELTAS}
     SELECT COUNT(*)::int                         AS readings,
            COALESCE(SUM(delta), 0)::bigint       AS total_bytes,
            COALESCE(SUM(tx_delta), 0)::bigint    AS tx_bytes,
            COALESCE(SUM(rx_delta), 0)::bigint    AS rx_bytes,
            MIN(recorded_at)                      AS first_reading_at,
            MAX(recorded_at)                      AS last_reading_at,
            COALESCE(SUM(gap_seconds) FILTER (
              WHERE gap_seconds > 0 AND gap_seconds <= ${MAX_SAMPLE_GAP_SECONDS}
            ), 0)::bigint                         AS measured_seconds,
            COALESCE(MAX(delta / NULLIF(gap_seconds, 0)), 0)::bigint AS peak_bytes_per_second
     FROM d`,
    { from, to },
  );

  return {
    readings: row.readings,
    total_bytes: row.total_bytes,
    tx_bytes: row.tx_bytes,
    rx_bytes: row.rx_bytes,
    first_reading_at: row.first_reading_at?.toISOString() ?? null,
    last_reading_at: row.last_reading_at?.toISOString() ?? null,
    measured_seconds: row.measured_seconds,
    peak_bytes_per_second: row.peak_bytes_per_second,
    avg_bytes_per_second:
      row.measured_seconds > 0 ? Math.round(row.total_bytes / row.measured_seconds) : 0,
  };
}

// ------------------------------------------------------------- series ----

export interface SeriesPoint {
  /** Start of the bucket as local wall-clock time, "YYYY-MM-DDTHH:MM:SS". */
  bucket: string;
  total_bytes: number;
  tx_bytes: number;
  rx_bytes: number;
  readings: number;
}

/**
 * Traffic grouped into equal buckets of local time. Buckets with no readings
 * are absent rather than zero; the chart fills them (see lib/series.ts), which
 * keeps a year of empty history out of the payload.
 */
export function getSeries(
  { from, to }: RangeParams,
  bucket: BucketUnit,
  timezone: string,
): Promise<SeriesPoint[]> {
  return db.any<SeriesPoint>(
    `WITH ${DELTAS}
     SELECT to_char(date_trunc(\${bucket}, recorded_at AT TIME ZONE \${timezone}),
                    'YYYY-MM-DD"T"HH24:MI:SS')       AS bucket,
            COALESCE(SUM(delta), 0)::bigint          AS total_bytes,
            COALESCE(SUM(tx_delta), 0)::bigint       AS tx_bytes,
            COALESCE(SUM(rx_delta), 0)::bigint       AS rx_bytes,
            COUNT(*)::int                            AS readings
     FROM d
     GROUP BY 1
     ORDER BY 1`,
    { from, to, bucket, timezone },
  );
}

// ----------------------------------------------------------- patterns ----

export interface HeatCell {
  /** ISO weekday: 1 is Monday, 7 is Sunday. */
  weekday: number;
  /** Local hour, 0 to 23. */
  hour: number;
  total_bytes: number;
  readings: number;
}

/**
 * Traffic by local weekday and hour: at most 168 rows, from which the heatmap,
 * the hour-of-day profile and the weekday profile are all derived.
 */
export function getHeatmap({ from, to }: RangeParams, timezone: string): Promise<HeatCell[]> {
  return db.any<HeatCell>(
    `WITH ${DELTAS}
     SELECT EXTRACT(ISODOW FROM recorded_at AT TIME ZONE \${timezone})::int AS weekday,
            EXTRACT(HOUR   FROM recorded_at AT TIME ZONE \${timezone})::int AS hour,
            COALESCE(SUM(delta), 0)::bigint AS total_bytes,
            COUNT(*)::int                   AS readings
     FROM d
     GROUP BY 1, 2
     ORDER BY 1, 2`,
    { from, to, timezone },
  );
}

// --------------------------------------------------------- compliance ----

export interface ComplianceDay {
  day: string;
  /** Traffic inside the daily quota window only. */
  used_bytes: number;
  /** Whether the over-quota alert was sent for that day. */
  notified: boolean;
}

/**
 * Per-day usage measured over the daily quota window, which is the figure the
 * quota actually governs. Unlike the dashboard's baseline arithmetic this works
 * for any past day, including days the application never saw live.
 */
export function getComplianceDays(
  { from, to }: RangeParams,
  timezone: string,
  windowStart: string,
  windowEnd: string,
): Promise<ComplianceDay[]> {
  const { start: startSeconds, end: endSeconds } = windowSeconds(windowStart, windowEnd);
  return db.any<ComplianceDay>(
    `WITH ${DELTAS},
     w AS (
       SELECT (recorded_at AT TIME ZONE \${timezone})::date AS day, delta
       FROM d
       -- Compared as seconds since local midnight rather than as times: adding
       -- a minute to a Postgres time wraps 23:59 round to 00:00, which turned
       -- the usual window into a range that matched nothing (see windowSeconds).
       WHERE EXTRACT(EPOCH FROM (recorded_at AT TIME ZONE \${timezone})::time)
               >= \${startSeconds}
         AND EXTRACT(EPOCH FROM (recorded_at AT TIME ZONE \${timezone})::time)
               < \${endSeconds}
     )
     SELECT w.day::text                       AS day,
            COALESCE(SUM(w.delta), 0)::bigint AS used_bytes,
            COALESCE(bool_or(dw.notified), false) AS notified
     FROM w
     LEFT JOIN daily_windows dw ON dw.window_date = w.day
     GROUP BY w.day
     ORDER BY w.day`,
    { from, to, timezone, startSeconds, endSeconds },
  );
}

export interface ComplianceSummary {
  days: ComplianceDay[];
  days_measured: number;
  days_over: number;
  days_alerted: number;
  compliance_rate: number;
  worst_day: ComplianceDay | null;
  average_bytes: number;
  quota_bytes: number;
}

export function summariseCompliance(days: ComplianceDay[], quotaGb: number): ComplianceSummary {
  const quota = quotaBytes(quotaGb);
  const measured = days.length;
  const over = days.filter((d) => d.used_bytes > quota).length;
  const total = days.reduce((sum, d) => sum + d.used_bytes, 0);
  const worst = days.reduce<ComplianceDay | null>(
    (best, d) => (best === null || d.used_bytes > best.used_bytes ? d : best),
    null,
  );

  return {
    days,
    days_measured: measured,
    days_over: over,
    days_alerted: days.filter((d) => d.notified).length,
    compliance_rate: measured > 0 ? ((measured - over) / measured) * 100 : 100,
    worst_day: worst,
    average_bytes: measured > 0 ? Math.round(total / measured) : 0,
    quota_bytes: quota,
  };
}

// ------------------------------------------------------------ sessions ----

export interface SessionRangeStats {
  sessions: number;
  drops: number;
  tx_bytes: number;
  rx_bytes: number;
  total_bytes: number;
  uptime_seconds: number;
  downtime_seconds: number;
  longest_seconds: number;
  shortest_seconds: number;
  /** Mean uptime between one drop and the next. */
  mtbf_seconds: number;
  /** Share of the range the link was up, as a percentage. */
  availability: number;
}

interface SessionStatsRow {
  sessions: number;
  drops: number;
  tx_bytes: number;
  rx_bytes: number;
  total_bytes: number;
  uptime_seconds: number;
  downtime_seconds: number;
  longest_seconds: number;
  shortest_seconds: number;
}

/**
 * Session figures for the range. A session counts when it overlaps the range at
 * all; its traffic is its own whole-session total, because per-session counters
 * cannot be split across an arbitrary boundary.
 */
export async function getSessionStats({ from, to }: RangeParams): Promise<SessionRangeStats> {
  const row = await db.one<SessionStatsRow>(
    `WITH ordered AS (
       SELECT started_at, ended_at, tx_bytes, rx_bytes, total_bytes,
              COALESCE(ended_at, last_seen_at) AS finished_at,
              LAG(COALESCE(ended_at, last_seen_at)) OVER (ORDER BY started_at, id) AS prev_finished
       FROM sessions
     ),
     s AS (
       SELECT * FROM ordered
       WHERE finished_at >= COALESCE(\${from}::timestamptz, '-infinity'::timestamptz)
         AND started_at  <  \${to}::timestamptz
     )
     SELECT COUNT(*)::int                                AS sessions,
            COUNT(*) FILTER (WHERE ended_at IS NOT NULL)::int AS drops,
            COALESCE(SUM(tx_bytes), 0)::bigint           AS tx_bytes,
            COALESCE(SUM(rx_bytes), 0)::bigint           AS rx_bytes,
            COALESCE(SUM(total_bytes), 0)::bigint        AS total_bytes,
            COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (finished_at - started_at)), 0)), 0)::bigint
              AS uptime_seconds,
            -- Each gap is clipped to the range, so an outage that began before
            -- the range cannot report more downtime than the range contains.
            -- The first session ever has no predecessor and so no gap: without
            -- the CASE, GREATEST would drop the NULL and measure back to the
            -- start of the range.
            COALESCE(SUM(
              CASE WHEN prev_finished IS NULL THEN 0
                   ELSE GREATEST(EXTRACT(EPOCH FROM (
                     started_at - GREATEST(
                       prev_finished,
                       COALESCE(\${from}::timestamptz, prev_finished)
                     )
                   )), 0)
              END
            ), 0)::bigint                                AS downtime_seconds,
            COALESCE(MAX(GREATEST(EXTRACT(EPOCH FROM (finished_at - started_at)), 0)), 0)::bigint
              AS longest_seconds,
            COALESCE(MIN(GREATEST(EXTRACT(EPOCH FROM (finished_at - started_at)), 0)), 0)::bigint
              AS shortest_seconds
     FROM s`,
    { from, to },
  );

  const covered = row.uptime_seconds + row.downtime_seconds;
  return {
    ...row,
    mtbf_seconds: row.drops > 0 ? Math.round(row.uptime_seconds / row.drops) : row.uptime_seconds,
    availability: covered > 0 ? (row.uptime_seconds / covered) * 100 : 100,
  };
}

/** Upper bound of each duration bucket, in seconds. The last bucket is open. */
export const DURATION_BUCKETS = [300, 1800, 7200, 21600, 86400] as const;

export interface DurationBucket {
  bucket: number;
  label: string;
  sessions: number;
}

/** How session lengths are distributed, which shows whether drops cluster. */
export async function getSessionDurations(
  { from, to }: RangeParams,
  d: Dictionary,
): Promise<DurationBucket[]> {
  const rows = await db.any<{ bucket: number; sessions: number }>(
    `WITH s AS (
       SELECT GREATEST(EXTRACT(EPOCH FROM (COALESCE(ended_at, last_seen_at) - started_at)), 0) AS secs
       FROM sessions
       WHERE COALESCE(ended_at, last_seen_at) >= COALESCE(\${from}::timestamptz, '-infinity'::timestamptz)
         AND started_at < \${to}::timestamptz
     )
     SELECT CASE
              WHEN secs < 300   THEN 0
              WHEN secs < 1800  THEN 1
              WHEN secs < 7200  THEN 2
              WHEN secs < 21600 THEN 3
              WHEN secs < 86400 THEN 4
              ELSE 5
            END        AS bucket,
            COUNT(*)::int AS sessions
     FROM s
     GROUP BY 1`,
    { from, to },
  );

  const counts = new Map(rows.map((r) => [r.bucket, r.sessions]));
  return d.durationBuckets.map((label, bucket) => ({
    bucket,
    label,
    sessions: counts.get(bucket) ?? 0,
  }));
}

export interface TopSession {
  id: number;
  started_at: string;
  ended_at: string | null;
  total_bytes: number;
  tx_bytes: number;
  rx_bytes: number;
  uptime_seconds: number;
}

interface TopSessionRow extends Omit<TopSession, "started_at" | "ended_at"> {
  started_at: Date;
  ended_at: Date | null;
}

export async function getTopSessions({ from, to }: RangeParams, limit = 10): Promise<TopSession[]> {
  const rows = await db.any<TopSessionRow>(
    `SELECT id, started_at, ended_at, total_bytes, tx_bytes, rx_bytes,
            GREATEST(EXTRACT(EPOCH FROM (COALESCE(ended_at, last_seen_at) - started_at)), 0)::bigint
              AS uptime_seconds
     FROM sessions
     WHERE COALESCE(ended_at, last_seen_at) >= COALESCE(\${from}::timestamptz, '-infinity'::timestamptz)
       AND started_at < \${to}::timestamptz
     ORDER BY total_bytes DESC, started_at DESC
     LIMIT \${limit}`,
    { from, to, limit },
  );
  return rows.map((r) => ({
    ...r,
    started_at: r.started_at.toISOString(),
    ended_at: r.ended_at?.toISOString() ?? null,
  }));
}

export interface SelectedSessionTotals {
  sessions: number;
  tx_bytes: number;
  rx_bytes: number;
  total_bytes: number;
  uptime_seconds: number;
  first_started_at: string | null;
  last_ended_at: string | null;
  /** Ids that matched a row, so the caller can tell if any were stale. */
  matched_ids: number[];
}

interface SelectedTotalsRow {
  sessions: number;
  tx_bytes: number;
  rx_bytes: number;
  total_bytes: number;
  uptime_seconds: number;
  first_started_at: Date | null;
  last_ended_at: Date | null;
  matched_ids: number[] | null;
}

/** Totals for an explicit set of sessions, summed in the database. */
export async function getSelectedSessionTotals(ids: number[]): Promise<SelectedSessionTotals> {
  if (ids.length === 0) {
    return {
      sessions: 0,
      tx_bytes: 0,
      rx_bytes: 0,
      total_bytes: 0,
      uptime_seconds: 0,
      first_started_at: null,
      last_ended_at: null,
      matched_ids: [],
    };
  }

  const row = await db.one<SelectedTotalsRow>(
    `SELECT COUNT(*)::int                         AS sessions,
            COALESCE(SUM(tx_bytes), 0)::bigint    AS tx_bytes,
            COALESCE(SUM(rx_bytes), 0)::bigint    AS rx_bytes,
            COALESCE(SUM(total_bytes), 0)::bigint AS total_bytes,
            COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (
              COALESCE(ended_at, last_seen_at) - started_at
            )), 0)), 0)::bigint                   AS uptime_seconds,
            MIN(started_at)                       AS first_started_at,
            MAX(COALESCE(ended_at, last_seen_at)) AS last_ended_at,
            array_agg(id ORDER BY id)             AS matched_ids
     FROM sessions
     WHERE id = ANY(\${ids}::int[])`,
    { ids },
  );

  return {
    sessions: row.sessions,
    tx_bytes: row.tx_bytes,
    rx_bytes: row.rx_bytes,
    total_bytes: row.total_bytes,
    uptime_seconds: row.uptime_seconds,
    first_started_at: row.first_started_at?.toISOString() ?? null,
    last_ended_at: row.last_ended_at?.toISOString() ?? null,
    matched_ids: row.matched_ids ?? [],
  };
}

// ------------------------------------------------------ billing cycle ----

export interface CycleUsage {
  start: string;
  end: string;
  used_bytes: number;
  cap_bytes: number;
  cap_gb: number;
  percent_of_cap: number;
  projected_bytes: number;
  projected_percent: number;
  days_total: number;
  days_elapsed: number;
  days_remaining: number;
  /** Bytes per remaining day that would exactly reach the cap. */
  daily_budget_bytes: number;
  /** Average daily consumption so far. */
  daily_average_bytes: number;
  over: boolean;
}

export async function getCycleUsage(
  monthlyQuotaGb: number,
  cycleDay: number,
  timezone: string,
  now = new Date(),
): Promise<CycleUsage> {
  const { start, end } = cycleBounds(now, cycleDay, timezone);
  const progress = cycleProgress(now, start, end);
  const { total_bytes: used } = await getRangeSummary({ from: start, to: now });

  const cap = quotaBytes(monthlyQuotaGb);
  const projected = projectCycleUsage(used, now, start, end);
  const remaining = Math.max(0, cap - used);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    used_bytes: used,
    cap_bytes: cap,
    cap_gb: monthlyQuotaGb,
    percent_of_cap: cap > 0 ? (used / cap) * 100 : 0,
    projected_bytes: projected,
    projected_percent: cap > 0 ? (projected / cap) * 100 : 0,
    days_total: progress.days_total,
    days_elapsed: progress.days_elapsed,
    days_remaining: progress.days_remaining,
    daily_budget_bytes:
      progress.days_remaining > 0 ? Math.round(remaining / progress.days_remaining) : remaining,
    daily_average_bytes:
      progress.days_elapsed > 0 ? Math.round(used / progress.days_elapsed) : used,
    over: used > cap,
  };
}

// ------------------------------------------------------------ history ----

/** When the very first reading was stored, used to label the all-time range. */
export async function getFirstReadingAt(): Promise<string | null> {
  const row = await db.oneOrNone<{ at: Date | null }>(
    "SELECT MIN(recorded_at) AS at FROM interface_readings",
  );
  return row?.at?.toISOString() ?? null;
}
