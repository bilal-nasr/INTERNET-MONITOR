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
