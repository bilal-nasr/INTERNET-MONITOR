/**
 * The free hours in SQL: one rule for every query that has to tell free
 * traffic from counted traffic, so the cap, the daily window and the
 * statistics can never disagree about which bytes were free.
 */

import { freeWindowSeconds, type FreeWindow } from "@/lib/time";

/**
 * Whether a row's `recorded_at` falls inside the free hours, as a SQL
 * condition. The arguments are the query's own placeholders -- named
 * (`"${freeStart}"`) or positional (`"$4"`) -- for the start and end in seconds
 * since local midnight (end exclusive, both null when there are no free hours)
 * and the timezone. A start after the end is a range that crosses midnight.
 * Like the daily window, a delta belongs to the reading that closes it.
 *
 * Seconds rather than times, because adding a minute to a Postgres `time`
 * wraps 23:59 round to 00:00 (see windowSeconds in lib/time.ts).
 */
export function inFreeHoursSql(start: string, end: string, timezone: string): string {
  const s = `EXTRACT(EPOCH FROM (recorded_at AT TIME ZONE ${timezone})::time)`;
  return `(
    ${start}::int IS NOT NULL AND (
      CASE WHEN ${start}::int < ${end}::int
           THEN ${s} >= ${start}::int AND ${s} < ${end}::int
           ELSE ${s} >= ${start}::int OR ${s} < ${end}::int
      END
    )
  )`;
}

/** The free hours as the two bounds `inFreeHoursSql` reads, null when there are none. */
export function freeHoursBounds(free: FreeWindow | null): { freeStart: number | null; freeEnd: number | null } {
  const seconds = freeWindowSeconds(free);
  return { freeStart: seconds?.start ?? null, freeEnd: seconds?.end ?? null };
}
