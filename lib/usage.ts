import { db } from "@/lib/db";
import { quotaBytes } from "@/lib/format";
import type { SettingsRow } from "@/lib/settings";
import { isWithinWindow, localParts, localTimeInstant, toHHMM } from "@/lib/time";

export interface Reading {
  id: number;
  recorded_at: Date;
  tx_bytes: number;
  rx_bytes: number;
  total_bytes: number;
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
 * Done as an aggregate rather than in JavaScript because the router can push
 * every few seconds, which would otherwise mean transferring thousands of rows
 * on every single push.
 */
export async function sumUsageSince(since: Date, until: Date | null = null): Promise<number> {
  const row = await db.one<{ used: number }>(
    `WITH r AS (
       SELECT total_bytes,
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
     ), 0)::bigint AS used
     FROM r`,
    [since, until],
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
 * The day's window row and the usage since its baseline, in one round trip.
 *
 * Same arithmetic as `sumUsageSince`, with the window's baseline read inside
 * the query instead of fetched first and passed back in. The dashboard asks
 * for this on every refresh, and the two-step version cost it a second trip to
 * the database each time. A day with no window yet yields no row and zero used.
 */
async function getWindowUsage(
  date: string,
  until: Date | null,
): Promise<{ window: DailyWindow | null; used: number }> {
  const row = await db.oneOrNone<DailyWindow & { used: number }>(
    `WITH w AS (
       SELECT id, window_date, baseline_bytes, baseline_recorded_at, notified, notified_level
       FROM daily_windows WHERE window_date = $1
     ),
     r AS (
       SELECT ir.total_bytes,
              LAG(ir.total_bytes) OVER (
                PARTITION BY ir.interface_name ORDER BY ir.recorded_at, ir.id
              ) AS prev
       FROM interface_readings ir, w
       WHERE ir.recorded_at >= w.baseline_recorded_at
         AND ($2::timestamptz IS NULL OR ir.recorded_at < $2::timestamptz)
     )
     SELECT w.*,
            (SELECT COALESCE(SUM(
               CASE
                 WHEN prev IS NULL THEN 0
                 WHEN total_bytes >= prev THEN total_bytes - prev
                 ELSE total_bytes
               END
             ), 0)::bigint FROM r) AS used
     FROM w`,
    [date, until],
  );
  if (!row) return { window: null, used: 0 };
  const { used, ...window } = row;
  return { window, used };
}

export interface TodayUsage {
  /** When this snapshot was computed (ISO 8601). */
  generated_at: string;
  date: string;
  timezone: string;
  local_time: string;
  window: { start: string; end: string; active: boolean };
  quota_gb: number;
  quota_bytes: number;
  baseline: { bytes: number; recorded_at: string } | null;
  used_since_baseline: number;
  percent_of_quota: number;
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
  const [{ window, used }, readingsCount, latest] = await Promise.all([
    getWindowUsage(parts.date, windowEnd),
    countReadingsForLocalDate(parts.date, settings.timezone),
    getLatestReading(),
  ]);
  const quota = quotaBytes(settings.quota_gb);

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
    quota_gb: settings.quota_gb,
    quota_bytes: quota,
    baseline: window
      ? { bytes: window.baseline_bytes, recorded_at: window.baseline_recorded_at.toISOString() }
      : null,
    used_since_baseline: used,
    percent_of_quota: quota > 0 ? (used / quota) * 100 : 0,
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
