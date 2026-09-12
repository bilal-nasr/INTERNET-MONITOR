/**
 * Billing-cycle arithmetic for the monthly consumption cap.
 *
 * A cycle runs from local midnight on the configured day of the month to local
 * midnight on the same day of the next month. The day is clamped to the length
 * of each month, so a cycle anchored on the 31st still works in February.
 */

import { localParts, zonedTimeToUtc } from "@/lib/time";

const DAY_MS = 86_400_000;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return MONTH_LENGTHS[month - 1];
}

/** The given day, or the last day of that month when the month is shorter. */
export function clampDayToMonth(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month));
}

/** Shift a (year, month) pair by whole months, keeping month in 1..12. */
function addMonths(year: number, month: number, delta: number): [number, number] {
  const zero = year * 12 + (month - 1) + delta;
  return [Math.floor(zero / 12), (zero % 12) + 1];
}

export interface CycleBounds {
  /** Inclusive start of the cycle. */
  start: Date;
  /** Exclusive end of the cycle, which is the next cycle's start. */
  end: Date;
}

/**
 * The billing cycle containing `now`, or an earlier one when `offset` is
 * negative (-1 is the previous cycle).
 */
export function cycleBounds(
  now: Date,
  cycleDay: number,
  timezone: string,
  offset = 0,
): CycleBounds {
  const [y, m, d] = localParts(now, timezone).date.split("-").map(Number);

  // Before this month's anchor day the current cycle is still the one that
  // opened last month.
  const anchor = clampDayToMonth(y, m, cycleDay);
  const [baseYear, baseMonth] = d >= anchor ? [y, m] : addMonths(y, m, -1);

  const [sy, sm] = addMonths(baseYear, baseMonth, offset);
  const [ey, em] = addMonths(sy, sm, 1);

  return {
    start: zonedTimeToUtc(sy, sm, clampDayToMonth(sy, sm, cycleDay), 0, 0, 0, timezone),
    end: zonedTimeToUtc(ey, em, clampDayToMonth(ey, em, cycleDay), 0, 0, 0, timezone),
  };
}

export interface CycleProgress {
  days_total: number;
  days_elapsed: number;
  days_remaining: number;
  /** How far through the cycle we are, 0 to 1. */
  fraction: number;
}

export function cycleProgress(now: Date, start: Date, end: Date): CycleProgress {
  const totalMs = Math.max(0, end.getTime() - start.getTime());
  const elapsedMs = Math.min(Math.max(0, now.getTime() - start.getTime()), totalMs);
  // Rounded, because a cycle spanning a DST change is not a whole number of days.
  const daysTotal = Math.round(totalMs / DAY_MS);
  const daysElapsed = Math.min(Math.floor(elapsedMs / DAY_MS), daysTotal);

  return {
    days_total: daysTotal,
    days_elapsed: daysElapsed,
    days_remaining: Math.max(0, daysTotal - daysElapsed),
    fraction: totalMs > 0 ? elapsedMs / totalMs : 0,
  };
}

/**
 * The progress of a cycle that is over, stated the way a report about it should.
 *
 * Not `cycleProgress(end, start, end)`. That floors elapsed time into days
 * while it rounds the cycle's length, so a cycle that spans the spring DST
 * change -- 31 days less an hour, in Beirut in March -- would still close on
 * "day 30 of 31" with a day remaining. A finished cycle has used every one of
 * its days, whatever its length in milliseconds, so that is said outright.
 *
 * `cycleProgress` is left as it is: the dashboard gauge and the cap alerts ask
 * how far through a running cycle `now` is, and flooring is right for that.
 */
export function closedCycleProgress(start: Date, end: Date): CycleProgress {
  const { days_total, fraction } = cycleProgress(end, start, end);
  return { days_total, days_elapsed: days_total, days_remaining: 0, fraction };
}

/**
 * Where usage lands at the end of the cycle if the current rate holds.
 * Returns the actual total when the cycle has not started or has finished, so
 * a finished cycle reports what happened rather than a forecast.
 */
export function projectCycleUsage(usedBytes: number, now: Date, start: Date, end: Date): number {
  const { fraction } = cycleProgress(now, start, end);
  if (fraction <= 0) return usedBytes;
  return Math.round(usedBytes / fraction);
}
