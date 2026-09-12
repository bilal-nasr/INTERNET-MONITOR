/**
 * When old readings get thinned, and by how much per run.
 *
 * Thinning keeps the last reading of every (interface, hour) older than the
 * cutoff and deletes the rest. Every traffic figure is the growth of the
 * counter between consecutive readings, so the figures survive: the deltas
 * between the hourly survivors add up to the same total. What goes is
 * minute-level detail for old dates.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Days of readings processed per tick, so a first run on a year of data stays inside the route's time budget. */
export const MAX_DAYS_PER_TICK = 30;

/** Thinning runs at most this often. It is cheap, but it scans every old row. */
export const THIN_INTERVAL_MS = DAY_MS;

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
