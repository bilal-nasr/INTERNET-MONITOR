import { db } from "@/lib/db";
import { quotaBytes } from "@/lib/format";
import { freeHoursBounds, inFreeHoursSql } from "@/lib/free-hours";
import type { SettingsRow } from "@/lib/settings";
import {
  freeWindowOf,
  isWithinFreeWindow,
  isWithinWindow,
  localParts,
  localTimeInstant,
  toHHMM,
  type FreeWindow,
} from "@/lib/time";

export interface Reading {
  id: number;
  recorded_at: Date;
  tx_bytes: number;
  rx_bytes: number;
  total_bytes: number;
  /** The interface the counters were read from; deltas only mean something within one. */
  interface_name: string | null;
}

export interface DailyWindow {
  id: number;
  window_date: string;
  baseline_bytes: number;
  baseline_recorded_at: Date;
  notified: boolean;
  /** Highest alert mark (percent) already mailed for this day; 0 when none. */
  notified_level: number;
}

/**
 * Traffic carried since `since`, summed in the database.
 *
 * Counters only ever grow, so usage is normally last - first. When a reading is
 * lower than its predecessor the interface reset its counters, so that reading's
 * full value counts as usage since the reset instead of a negative delta.
 *
 * Deltas are taken within one interface only: two interfaces have unrelated
 * counter streams, and chaining them would read as one enormous transfer.
 *
 * `until` bounds the sum, so usage stays fixed once the quota window closes
 * instead of continuing to climb on traffic the quota does not govern.
 *
 * Traffic inside the free hours is left out: the daily quota does not count it
 * any more than the monthly cap does.
 *
 * Done as an aggregate rather than in JavaScript because the router can push
 * every few seconds, which would otherwise mean transferring thousands of rows
 * on every single push.
 */
export async function sumUsageSince(
  since: Date,
  until: Date | null = null,
  free: FreeWindow | null = null,
  timezone = "UTC",
): Promise<number> {
  const { freeStart, freeEnd } = freeHoursBounds(free);
  const row = await db.one<{ used: number }>(
    `WITH r AS (
       SELECT recorded_at, total_bytes,
              LAG(total_bytes) OVER (
                PARTITION BY interface_name ORDER BY recorded_at, id
              ) AS prev
       FROM interface_readings
       WHERE recorded_at >= $1
         AND ($2::timestamptz IS NULL OR recorded_at < $2::timestamptz)
     )
     SELECT COALESCE(SUM(
       CASE
         WHEN prev IS NULL THEN 0
         WHEN total_bytes >= prev THEN total_bytes - prev
         ELSE total_bytes
       END
     ) FILTER (WHERE NOT ${inFreeHoursSql("$3", "$4", "$5::text")}), 0)::bigint AS used
     FROM r`,
    [since, until, freeStart, freeEnd, timezone],
  );
  return row.used;
}

export async function getLatestReading(): Promise<Reading | null> {
  return db.oneOrNone<Reading>(
    "SELECT * FROM interface_readings ORDER BY recorded_at DESC, id DESC LIMIT 1",
  );
}

/** How many readings landed on the given local date. */
export async function countReadingsForLocalDate(date: string, timezone: string): Promise<number> {
  const row = await db.one<{ readings: number }>(
    `SELECT COUNT(*)::int AS readings
     FROM interface_readings
     WHERE recorded_at >= ($1::date::timestamp AT TIME ZONE $2)
       AND recorded_at <  (($1::date + 1)::timestamp AT TIME ZONE $2)`,
    [date, timezone],
  );
  return row.readings;
}

export async function getDailyWindow(date: string): Promise<DailyWindow | null> {
  return db.oneOrNone<DailyWindow>("SELECT * FROM daily_windows WHERE window_date = $1", [date]);
}

/**
 * The day's window row and the usage since its baseline, in one round trip,
 * split into what the quota counts and what fell in the free hours.
 *
 * Same arithmetic as `sumUsageSince`, with the window's baseline read inside
 * the query instead of fetched first and passed back in. The dashboard asks
 * for this on every refresh, and the two-step version cost it a second trip to
 * the database each time. A day with no window yet yields no row and zero used.
 */
async function getWindowUsage(
  date: string,
  until: Date | null,
  free: FreeWindow | null,
  timezone: string,
): Promise<{ window: DailyWindow | null; used: number; free: number }> {
  const { freeStart, freeEnd } = freeHoursBounds(free);
  const inFree = inFreeHoursSql("$3", "$4", "$5::text");
  const row = await db.oneOrNone<DailyWindow & { used: number; free_bytes: number }>(
    `WITH w AS (
       SELECT id, window_date, baseline_bytes, baseline_recorded_at, notified, notified_level
       FROM daily_windows WHERE window_date = $1
     ),
     r AS (
       SELECT ir.recorded_at, ir.total_bytes,
              LAG(ir.total_bytes) OVER (
                PARTITION BY ir.interface_name ORDER BY ir.recorded_at, ir.id
              ) AS prev
       FROM interface_readings ir, w
       WHERE ir.recorded_at >= w.baseline_recorded_at
         AND ($2::timestamptz IS NULL OR ir.recorded_at < $2::timestamptz)
     ),
     d AS (
       SELECT recorded_at,
              CASE
                WHEN prev IS NULL THEN 0
                WHEN total_bytes >= prev THEN total_bytes - prev
                ELSE total_bytes
              END AS delta
       FROM r
     )
     SELECT w.*,
            (SELECT COALESCE(SUM(delta) FILTER (WHERE NOT ${inFree}), 0)::bigint FROM d) AS used,
            (SELECT COALESCE(SUM(delta) FILTER (WHERE ${inFree}), 0)::bigint FROM d) AS free_bytes
     FROM w`,
    [date, until, freeStart, freeEnd, timezone],
  );
  if (!row) return { window: null, used: 0, free: 0 };
  const { used, free_bytes, ...window } = row;
  return { window, used, free: free_bytes };
}

export interface TodayUsage {
  /** When this snapshot was computed (ISO 8601). */
  generated_at: string;
  date: string;
  timezone: string;
  local_time: string;
  window: { start: string; end: string; active: boolean };
  /** The daily quota, or null when it is turned off in /settings. */
  quota_gb: number | null;
  quota_bytes: number | null;
  baseline: { bytes: number; recorded_at: string } | null;
  /** What the daily quota counts: the window's traffic, less any free hours. */
  used_since_baseline: number;
  /**
   * The free hours, whether they are running now, and the window's traffic
   * inside them today -- not counted, and not part of `used_since_baseline`.
   * Null while the free hours are off.
   */
  free: (FreeWindow & { active: boolean; bytes: number }) | null;
  percent_of_quota: number | null;
  notified: boolean;
  notified_level: number;
  last_reading: {
    recorded_at: string;
    tx_bytes: number;
    rx_bytes: number;
    total_bytes: number;
  } | null;
  /** Readings stored today. The rows themselves are available from /api/export. */
  readings_count: number;
}

export async function getTodayUsage(settings: SettingsRow, now = new Date()): Promise<TodayUsage> {
  const parts = localParts(now, settings.timezone);
  // The window end is inclusive to the minute, so the exclusive bound is the
  // start of the following minute.
  const windowEnd = localTimeInstant(parts.date, settings.window_end, settings.timezone, 1);
  const freeWindow = freeWindowOf(settings);
  const [{ window, used, free }, readingsCount, latest] = await Promise.all([
    getWindowUsage(parts.date, windowEnd, freeWindow, settings.timezone),
    countReadingsForLocalDate(parts.date, settings.timezone),
    getLatestReading(),
  ]);
  const quota = settings.daily_quota_enabled ? quotaBytes(settings.quota_gb) : null;

  return {
    generated_at: now.toISOString(),
    date: parts.date,
    timezone: settings.timezone,
    local_time: parts.time,
    window: {
      start: toHHMM(settings.window_start),
      end: toHHMM(settings.window_end),
      active: isWithinWindow(parts.minutes, settings.window_start, settings.window_end),
    },
    quota_gb: quota === null ? null : settings.quota_gb,
    quota_bytes: quota,
    baseline: window
      ? { bytes: window.baseline_bytes, recorded_at: window.baseline_recorded_at.toISOString() }
      : null,
    used_since_baseline: used,
    free: freeWindow && {
      ...freeWindow,
      active: isWithinFreeWindow(parts.minutes, freeWindow),
      bytes: free,
    },
    percent_of_quota: quota === null ? null : quota > 0 ? (used / quota) * 100 : 0,
    notified: window?.notified ?? false,
    notified_level: window?.notified_level ?? 0,
    last_reading: latest
      ? {
          recorded_at: latest.recorded_at.toISOString(),
          tx_bytes: latest.tx_bytes,
          rx_bytes: latest.rx_bytes,
          total_bytes: latest.total_bytes,
        }
      : null,
    readings_count: readingsCount,
  };
}

export interface DailyUsage {
  day: string;
  readings: number;
  min_bytes: number;
  max_bytes: number;
  /** Reboot-aware traffic for the day (sum of positive counter deltas). */
  used_bytes: number;
}

/**
 * Daily aggregates for the last `days` local days, including today.
 * `used_bytes` is computed from consecutive-reading deltas so router reboots
 * (counter resets) do not produce bogus values.
 */
export async function getDailyHistory(days: number, timezone: string): Promise<DailyUsage[]> {
  return db.any<DailyUsage>(
    `WITH bounds AS (
       SELECT ((now() AT TIME ZONE $2::text)::date - ($1::int - 1)) AS start_day
     ),
     r AS (
       SELECT recorded_at, total_bytes,
              LAG(total_bytes) OVER (
                PARTITION BY interface_name ORDER BY recorded_at, id
              ) AS prev_bytes
       FROM interface_readings, bounds
       -- include a little history before the range so the first delta of the
       -- first day is not lost
       WHERE recorded_at >= (bounds.start_day::timestamp AT TIME ZONE $2::text) - INTERVAL '1 hour'
     ),
     d AS (
       SELECT (recorded_at AT TIME ZONE $2::text)::date AS day,
              total_bytes,
              CASE
                WHEN prev_bytes IS NULL THEN 0
                WHEN total_bytes >= prev_bytes THEN total_bytes - prev_bytes
                ELSE total_bytes
              END AS delta
       FROM r
     )
     SELECT d.day::text AS day,
            COUNT(*)::int AS readings,
            MIN(total_bytes) AS min_bytes,
            MAX(total_bytes) AS max_bytes,
            COALESCE(SUM(delta), 0)::bigint AS used_bytes
     FROM d, bounds
     WHERE d.day >= bounds.start_day
     GROUP BY d.day
     ORDER BY d.day ASC`,
    [days, timezone],
  );
}

/**
 * The raw readings of the last `minutes`, oldest first. Bounded by time rather
 * than by count so a router pushing every 30 seconds and one pushing every
 * minute both yield the same span on the throughput sparkline.
 *
 * `interface_name` comes back with every row because the rate is a delta
 * between two of them, and a delta across two interfaces is not a rate at all:
 * `ratesFromReadings` needs the name to drop such a pair.
 */
export async function getRecentReadings(minutes: number): Promise<Reading[]> {
  return db.any<Reading>(
    `SELECT id, recorded_at, tx_bytes, rx_bytes, total_bytes, interface_name
     FROM interface_readings
     WHERE recorded_at >= now() - make_interval(mins => $1)
     ORDER BY recorded_at ASC, id ASC`,
    [minutes],
  );
}
