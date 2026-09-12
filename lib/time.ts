/** Time helpers. All "local" values are expressed in the timezone from settings. */

export interface LocalParts {
  /** YYYY-MM-DD in the target timezone */
  date: string;
  /** HH:MM in the target timezone */
  time: string;
  /** Minutes since local midnight */
  minutes: number;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    minutes: hour * 60 + minute,
  };
}

/** "14:00" or "14:00:00" -> minutes since midnight. Returns null when unparseable. */
export function timeToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "14:00:00" (Postgres TIME) -> "14:00" for <input type="time"> and display. */
export function toHHMM(value: string): string {
  const mins = timeToMinutes(value);
  if (mins === null) return value;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/**
 * The daily quota window as seconds since local midnight, with an exclusive end.
 *
 * The stored end is inclusive to the minute, so the exclusive bound is one
 * minute later. That arithmetic belongs here rather than in SQL because
 * Postgres `time` wraps: `'23:59'::time + INTERVAL '1 minute'` is `00:00`, which
 * turns the usual window into a range matching nothing. Seconds do not wrap, so
 * a window ending at 23:59 correctly bounds at a full day.
 *
 * An unparseable time falls back to the whole day, so a malformed setting
 * over-reports rather than silently reporting no usage at all.
 */
export function windowSeconds(start: string, end: string): { start: number; end: number } {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (startMinutes === null || endMinutes === null) return { start: 0, end: 86_400 };
  return { start: startMinutes * 60, end: (endMinutes + 1) * 60 };
}

/** Inclusive check: start <= now <= end. Windows never cross midnight (enforced by validation). */
export function isWithinWindow(nowMinutes: number, windowStart: string, windowEnd: string): boolean {
  const start = timeToMinutes(windowStart);
  const end = timeToMinutes(windowEnd);
  if (start === null || end === null) return false;
  return nowMinutes >= start && nowMinutes <= end;
}

/** Minutes that `timeZone` is ahead of UTC at the given instant. */
function tzOffsetMinutes(utcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - utcMs) / 60000;
}

/** Wall-clock time in `timeZone` to an absolute instant. Handles DST via a fixpoint. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let ts = naive;
  for (let i = 0; i < 3; i++) {
    const next = naive - tzOffsetMinutes(ts, timeZone) * 60000;
    if (next === ts) break;
    ts = next;
  }
  return new Date(ts);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a RouterOS date-time as local time in `timeZone`. Accepts both the
 * ISO-style format of RouterOS 7.10+ ("2026-09-10 22:00:56") and the older
 * month-name format ("sep/10/2026 22:00:56"). Returns null when unparseable.
 */
export function parseRouterTimestamp(value: string | null | undefined, timeZone: string): Date | null {
  if (!value) return null;
  const v = value.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (iso) {
    return zonedTimeToUtc(+iso[1], +iso[2], +iso[3], +iso[4], +iso[5], +(iso[6] ?? 0), timeZone);
  }

  const named = /^([a-zA-Z]{3})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    if (!month) return null;
    return zonedTimeToUtc(+named[3], month, +named[2], +named[4], +named[5], +(named[6] ?? 0), timeZone);
  }

  return null;
}

/** The suffixes a duration is written with, which differ by language. */
export interface DurationUnits {
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
}

const EN_UNITS: DurationUnits = { days: "d", hours: "h", minutes: "m", seconds: "s" };

/**
 * "2d 3h 14m", "3h 14m", "14m 05s", "42s". Null-safe.
 *
 * Only the two largest units that carry information are shown, so the figure
 * stays the same width whatever the magnitude. Callers inside the application
 * pass the suffixes from the active dictionary; the English default is here so
 * a caller outside a request (a log line, a test) still reads sensibly.
 */
export function formatDuration(
  seconds: number | null | undefined,
  units: DurationUnits = EN_UNITS,
): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "-";
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}${units.days} ${h}${units.hours} ${m}${units.minutes}`;
  if (h > 0) return `${h}${units.hours} ${String(m).padStart(2, "0")}${units.minutes}`;
  if (m > 0) return `${m}${units.minutes} ${String(sec).padStart(2, "0")}${units.seconds}`;
  return `${sec}${units.seconds}`;
}

/**
 * The absolute instant a wall-clock time falls on, for a given local date.
 * `minuteOffset` shifts by whole minutes, which is how the inclusive end of a
 * window ("<= 23:59") becomes the exclusive bound 00:00 the next day.
 */
export function localTimeInstant(
  date: string,
  time: string,
  timeZone: string,
  minuteOffset = 0,
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const mins = timeToMinutes(time);
  if (!m || mins === null) return null;

  const total = mins + minuteOffset;
  const dayShift = Math.floor(total / 1440);
  const inDay = ((total % 1440) + 1440) % 1440;

  // Shift the calendar day first, so a bound past midnight lands on the next date.
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dayShift);
  const d = new Date(base);
  return zonedTimeToUtc(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    Math.floor(inDay / 60),
    inDay % 60,
    0,
    timeZone,
  );
}

/**
 * The local date one day before `date`, both "YYYY-MM-DD". Used to show an
 * exclusive end bound as the inclusive last day it covers.
 *
 * Calendar arithmetic on the date itself, deliberately: the date is already
 * local, so the answer never depends on the clock, and going through an instant
 * would be wrong in a zone whose DST change lands on midnight (Asia/Beirut
 * springs forward at 00:00, so the local midnight of that day does not exist).
 * An unparseable value is returned unchanged rather than guessed at.
 */
export function previousLocalDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return date;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
