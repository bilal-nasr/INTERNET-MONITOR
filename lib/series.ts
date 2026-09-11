/**
 * Shaping the aggregates from lib/stats.ts into what a chart needs.
 *
 * Kept apart from the queries because none of it touches the database: the
 * database returns only the buckets that hold readings, which keeps a year of
 * empty history out of the payload, and these helpers rebuild the gaps.
 *
 * Bucket keys are local wall-clock times ("YYYY-MM-DDTHH:MM:SS"), exactly as
 * `to_char` produced them, so the labels never shift under a timezone change.
 */

import { cycleBounds } from "@/lib/billing";
import { fill, type Dictionary } from "@/lib/i18n";
import type { BucketUnit } from "@/lib/range";
import type { HeatCell, SeriesPoint } from "@/lib/stats";
import { localParts } from "@/lib/time";

/**
 * A local wall clock, carried in a Date whose UTC fields hold the local
 * components. Stepping through it with the UTC setters is deliberate: buckets
 * are labelled by wall-clock time, so a DST change should make an hour repeat
 * or go missing rather than shift every later label by an hour.
 */
function toWallClock(date: Date, timezone: string): Date {
  const { date: day, time } = localParts(date, timezone);
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
}

function formatWallClock(wall: Date): string {
  return wall.toISOString().slice(0, 19);
}

function truncate(wall: Date, bucket: BucketUnit): Date {
  const out = new Date(wall.getTime());
  switch (bucket) {
    case "minute":
      out.setUTCSeconds(0, 0);
      return out;
    case "hour":
      out.setUTCMinutes(0, 0, 0);
      return out;
    case "day":
      out.setUTCHours(0, 0, 0, 0);
      return out;
    case "week":
      out.setUTCHours(0, 0, 0, 0);
      // Monday-based, matching Postgres date_trunc on week.
      out.setUTCDate(out.getUTCDate() - ((out.getUTCDay() + 6) % 7));
      return out;
    case "month":
      out.setUTCHours(0, 0, 0, 0);
      out.setUTCDate(1);
      return out;
  }
}

function advance(wall: Date, bucket: BucketUnit): Date {
  const out = new Date(wall.getTime());
  switch (bucket) {
    case "minute":
      out.setUTCMinutes(out.getUTCMinutes() + 1);
      return out;
    case "hour":
      out.setUTCHours(out.getUTCHours() + 1);
      return out;
    case "day":
      out.setUTCDate(out.getUTCDate() + 1);
      return out;
    case "week":
      out.setUTCDate(out.getUTCDate() + 7);
      return out;
    case "month":
      out.setUTCMonth(out.getUTCMonth() + 1);
      return out;
  }
}

function emptyPoint(bucket: string): SeriesPoint {
  return { bucket, total_bytes: 0, tx_bytes: 0, rx_bytes: 0, readings: 0 };
}

/**
 * One entry per bucket between `from` and `to`, so a quiet hour reads as zero
 * rather than closing the gap and making the chart lie about when traffic
 * happened. An open-ended range is returned as-is: there is no start to fill
 * from, and the first reading is already the first bucket.
 */
export function fillSeries(
  points: SeriesPoint[],
  from: Date | null,
  to: Date,
  bucket: BucketUnit,
  timezone: string,
): SeriesPoint[] {
  if (from === null) return points;

  const byBucket = new Map(points.map((p) => [p.bucket, p]));
  // `to` is exclusive, so a bucket is included only when it opens before it.
  // A range ending exactly on a boundary therefore stops at the bucket before,
  // while a range ending mid-bucket still shows that partial bucket.
  const end = toWallClock(to, timezone).getTime();
  const out: SeriesPoint[] = [];

  for (
    let cursor = truncate(toWallClock(from, timezone), bucket);
    cursor.getTime() < end;
    cursor = advance(cursor, bucket)
  ) {
    const key = formatWallClock(cursor);
    out.push(byBucket.get(key) ?? emptyPoint(key));
  }

  return out;
}

export interface CycleTotal {
  /** Local date the cycle opened on, "YYYY-MM-DD". */
  start_date: string;
  end_date: string;
  label: string;
  total_bytes: number;
  tx_bytes: number;
  rx_bytes: number;
  current: boolean;
}

/**
 * Day buckets folded into billing cycles. Cycle boundaries fall on local
 * midnight, which is exactly where day buckets begin, so every day belongs to
 * one cycle and none is split.
 */
export function foldIntoCycles(
  days: SeriesPoint[],
  cycleDay: number,
  timezone: string,
  count: number,
  now = new Date(),
): CycleTotal[] {
  const out: CycleTotal[] = [];

  for (let offset = count - 1; offset >= 0; offset--) {
    const { start, end } = cycleBounds(now, cycleDay, timezone, -offset);
    const startDate = localParts(start, timezone).date;
    const endDate = localParts(end, timezone).date;

    // Day keys are "YYYY-MM-DDT00:00:00", so comparing the date prefix as text
    // is both correct and cheap.
    const inCycle = days.filter((d) => {
      const day = d.bucket.slice(0, 10);
      return day >= startDate && day < endDate;
    });

    out.push({
      start_date: startDate,
      end_date: endDate,
      label: startDate.slice(0, 7),
      total_bytes: inCycle.reduce((sum, d) => sum + d.total_bytes, 0),
      tx_bytes: inCycle.reduce((sum, d) => sum + d.tx_bytes, 0),
      rx_bytes: inCycle.reduce((sum, d) => sum + d.rx_bytes, 0),
      current: offset === 0,
    });
  }

  return out;
}

/**
 * Bucket keys are already local wall-clock text, so they are formatted by
 * slicing rather than by parsing into a Date. Parsing would reintroduce a
 * timezone conversion that has already been done in the database, and handing
 * the key to Intl would undo the very thing the database was asked to do. The
 * month name is the one part that is a word, so it comes from the dictionary.
 */
function parts(bucket: string, d: Dictionary) {
  return {
    year: bucket.slice(0, 4),
    month: d.monthsShort[Number(bucket.slice(5, 7)) - 1],
    day: String(Number(bucket.slice(8, 10))),
    time: bucket.slice(11, 16),
  };
}

/** Short axis label: only what distinguishes one bucket from its neighbours. */
export function formatBucketLabel(bucket: string, unit: BucketUnit, d: Dictionary): string {
  const p = parts(bucket, d);
  if (unit === "minute" || unit === "hour") return p.time;
  if (unit === "month") return `${p.month} ${p.year}`;
  return `${p.day} ${p.month}`;
}

/** Unambiguous heading for a tooltip, where there are no neighbours for context. */
export function formatBucketTitle(bucket: string, unit: BucketUnit, d: Dictionary): string {
  const p = parts(bucket, d);
  const date = `${p.day} ${p.month} ${p.year}`;
  if (unit === "minute" || unit === "hour") return fill(d.buckets.dateAtTime, { date, time: p.time });
  if (unit === "week") return fill(d.buckets.weekOf, { date });
  if (unit === "month") return `${p.month} ${p.year}`;
  return date;
}

export interface ProfileBar {
  index: number;
  label: string;
  total_bytes: number;
  readings: number;
}

/** Traffic by local hour, every hour present so the shape of the day is visible. */
export function hourProfile(cells: HeatCell[]): ProfileBar[] {
  const bars: ProfileBar[] = Array.from({ length: 24 }, (_, hour) => ({
    index: hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    total_bytes: 0,
    readings: 0,
  }));
  for (const cell of cells) {
    const bar = bars[cell.hour];
    if (!bar) continue;
    bar.total_bytes += cell.total_bytes;
    bar.readings += cell.readings;
  }
  return bars;
}

/** Traffic by local weekday, Monday first. */
export function weekdayProfile(cells: HeatCell[], d: Dictionary): ProfileBar[] {
  const bars: ProfileBar[] = d.weekdays.map((label, index) => ({
    index,
    label,
    total_bytes: 0,
    readings: 0,
  }));
  for (const cell of cells) {
    // ISO weekday is 1 for Monday; the array is 0-based.
    const bar = bars[cell.weekday - 1];
    if (!bar) continue;
    bar.total_bytes += cell.total_bytes;
    bar.readings += cell.readings;
  }
  return bars;
}

/** The single busiest weekday-and-hour slot, or null when nothing was recorded. */
export function peakCell(cells: HeatCell[]): HeatCell | null {
  return cells.reduce<HeatCell | null>(
    (best, cell) => (best === null || cell.total_bytes > best.total_bytes ? cell : best),
    null,
  );
}
