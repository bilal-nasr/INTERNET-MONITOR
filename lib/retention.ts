/**
 * When old readings get thinned, by how much per run, and the exact SQL that
 * does it.
 *
 * Thinning keeps the last reading of every (interface, hour) older than the
 * cutoff and deletes the rest. Every traffic figure is the growth of the
 * counter between consecutive readings, so the figures survive: the deltas
 * between the hourly survivors add up to the same total. What goes is
 * minute-level detail for old dates.
 *
 * The statements live here, next to the rules, because they are the most
 * destructive thing the application can do and they have to be readable and
 * testable without a database. lib/cron/thin.ts is only the plumbing that runs
 * them; it can also run every one of them in "count" form, which touches
 * nothing and reports the number of rows the matching DELETE would remove.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Days of readings processed per tick, so a first run on a year of data stays inside the route's time budget. */
export const MAX_DAYS_PER_TICK = 30;

/**
 * Wall-clock budget for one thinning tick. The route is capped at
 * maxDuration = 60, and a tick also has the other jobs to get through, so the
 * day loop stops when it has spent this long however many days are left. The
 * remaining days are picked up by the next run; a day already thinned is never
 * chosen again, so progress needs no cursor.
 */
export const THIN_TIME_BUDGET_MS = 30_000;

/** Device rows a single tick may prune, so the prune cannot become the slow statement. */
export const MAX_DEVICE_PRUNE_PER_TICK = 500;

/** Thinning runs at most this often. It is cheap, but it scans every old row. */
export const THIN_INTERVAL_MS = DAY_MS;

/**
 * The distance between two surviving readings once a stretch has been thinned:
 * one row per hour. lib/stats.ts has to treat a gap this size as measured time
 * rather than as an outage, so its cut sits above this (see MAX_SAMPLE_GAP_SECONDS).
 */
export const THINNED_SAMPLE_GAP_SECONDS = 3600;

/**
 * Everything recorded before this instant is subject to thinning. Truncated
 * to the hour so no hour bucket is ever half thinned: a bucket is either
 * entirely before the cutoff, or untouched.
 */
export function thinningCutoff(now: Date, retentionDays: number): Date {
  const raw = now.getTime() - retentionDays * DAY_MS;
  return new Date(Math.floor(raw / HOUR_MS) * HOUR_MS);
}

export function isThinDue(lastRunAt: Date | null, now: Date): boolean {
  if (!lastRunAt) return true;
  return now.getTime() - lastRunAt.getTime() >= THIN_INTERVAL_MS;
}

/** True once a tick that began at `startedMs` has used up its wall-clock budget. */
export function isThinBudgetSpent(
  startedMs: number,
  nowMs: number,
  budgetMs: number = THIN_TIME_BUDGET_MS,
): boolean {
  return nowMs - startedMs >= budgetMs;
}

// ---------------------------------------------------------------- SQL ----

/**
 * `count` builds the read-only twin of `delete`: same rows, same predicate,
 * COUNT(*) instead of the DELETE. Every destructive statement below has one, so
 * a run can be checked before it removes anything.
 */
export type ThinMode = "delete" | "count";

/** The two tables that get thinned, and the column a counter chain belongs to. */
export interface ThinTarget {
  table: "interface_readings" | "device_readings";
  partition: "interface_name" | "mac";
}

export const INTERFACE_TARGET: ThinTarget = {
  table: "interface_readings",
  partition: "interface_name",
};
export const DEVICE_TARGET: ThinTarget = { table: "device_readings", partition: "mac" };

/**
 * Days (UTC, truncated) before the cutoff that still hold more than one
 * reading in some hour, oldest first. A day already thinned has at most one
 * row per chain per hour and never comes back, so each tick simply takes the
 * next batch of unthinned days.
 *
 * $1 is the cutoff, $2 the number of days to return.
 *
 * The table and partition names are interpolated, not bound: they come from
 * the closed set of ThinTarget values above, never from a request.
 */
export function daysToThinSql({ table, partition }: ThinTarget): string {
  return `
  SELECT date_trunc('day', hour) AS day
  FROM (
    SELECT date_trunc('hour', recorded_at) AS hour, COUNT(*) AS n
    FROM ${table}
    WHERE recorded_at < $1::timestamptz
    GROUP BY ${partition}, date_trunc('hour', recorded_at)
  ) h
  WHERE n > 1
  GROUP BY day
  ORDER BY day
  LIMIT $2`;
}

/**
 * Within one day, every reading that is not the newest of its (chain, hour).
 * The day is clipped to the cutoff, which is hour-aligned, so an hour is never
 * split between kept and deleted.
 *
 * $1 is the start of the day, $2 the cutoff.
 */
export function thinDaySql({ table, partition }: ThinTarget, mode: ThinMode): string {
  const ranked = `
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY ${partition}, date_trunc('hour', recorded_at)
             ORDER BY recorded_at DESC, id DESC
           ) AS rn
    FROM ${table}
    WHERE recorded_at >= $1::timestamptz
      AND recorded_at <  LEAST($1::timestamptz + INTERVAL '1 day', $2::timestamptz)
  )`;
  return mode === "count"
    ? `${ranked}
  SELECT COUNT(*)::int AS rows FROM ranked WHERE rn > 1`
    : `${ranked}
  DELETE FROM ${table}
  WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`;
}

/**
 * Devices with nothing left inside the retention window: no reading at or
 * after the cutoff. Nothing else ever removes a `devices` row, while the
 * ingest route creates one for any MAC it is handed, so without this a phone
 * that randomises its MAC every join adds a row a day for ever and the
 * "Devices seen" tile counts ghosts.
 *
 * Their old readings go with them through the ON DELETE CASCADE on
 * device_readings.mac. A device that is still pushing is never chosen, because
 * every push writes a reading at the current instant.
 *
 * $1 is the cutoff, $2 the number of devices one tick may prune.
 */
export function pruneDevicesSql(mode: ThinMode): string {
  const stale = `
    SELECT d.mac
    FROM devices d
    WHERE NOT EXISTS (
      SELECT 1 FROM device_readings r
      WHERE r.mac = d.mac AND r.recorded_at >= $1::timestamptz
    )
    ORDER BY d.last_seen
    LIMIT $2`;
  return mode === "count"
    ? `SELECT COUNT(*)::int AS rows FROM (${stale}) stale`
    : `DELETE FROM devices WHERE mac IN (${stale})`;
}
