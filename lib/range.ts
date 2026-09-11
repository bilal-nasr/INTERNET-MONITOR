/**
 * Time-range presets for the statistics page.
 *
 * Every range resolves, server-side, to an absolute [from, to) pair in the
 * settings timezone plus the bucket width the series should be grouped by.
 * Resolving here rather than in the browser keeps the URL shareable and means
 * the database is always asked an unambiguous question.
 */

import { cycleBounds } from "@/lib/billing";
import { fill, type Dictionary } from "@/lib/i18n";
import { localParts, zonedTimeToUtc } from "@/lib/time";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const BUCKETS = ["minute", "hour", "day", "week", "month"] as const;
export type BucketUnit = (typeof BUCKETS)[number];

/** Approximate width of each bucket, used only to size a series. */
const BUCKET_MS: Record<BucketUnit, number> = {
  minute: MINUTE_MS,
  hour: HOUR_MS,
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
};

/** Beyond this a chart is unreadable and the payload is wasteful. */
const MAX_BUCKETS = 2000;

export const RANGE_PRESETS = [
  "last_hour",
  "last_6h",
  "last_24h",
  "today",
  "yesterday",
  "this_week",
  "last_7d",
  "this_cycle",
  "last_cycle",
  "last_30d",
  "last_90d",
  "this_year",
  "all_time",
  "custom",
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

export const DEFAULT_PRESET: RangePreset = "today";

/** The name shown for a preset, in the reader's language. */
export function rangeLabel(d: Dictionary, preset: RangePreset): string {
  return d.ranges[preset];
}

export type RangeErrorCode = keyof Dictionary["errors"]["range"];

/**
 * A range the application cannot make sense of.
 *
 * The reason is carried as a code and its values rather than as a sentence,
 * because a range is rejected deep in this module while the language to explain
 * it in is only known at the edge: a page renders in the language of its URL, a
 * Route Handler in the language its caller asked for. `message` stays English
 * for the server log.
 */
export class InvalidRangeError extends Error {
  readonly code: RangeErrorCode;
  readonly params: Record<string, string | number>;

  constructor(code: RangeErrorCode, params: Record<string, string | number>, message: string) {
    super(message);
    this.name = "InvalidRangeError";
    this.code = code;
    this.params = params;
  }
}

/** The reason a range was rejected, written out in the reader's language. */
export function rangeErrorMessage(d: Dictionary, err: InvalidRangeError): string {
  return fill(d.errors.range[err.code], err.params);
}

export function isRangePreset(value: string): value is RangePreset {
  return (RANGE_PRESETS as readonly string[]).includes(value);
}

export function isBucket(value: string): value is BucketUnit {
  return (BUCKETS as readonly string[]).includes(value);
}

/**
 * The widest bucket that still shows detail over `spanMs`. An unbounded span
 * (all time) gets months, since the history could be years long.
 */
export function chooseBucket(spanMs: number | null): BucketUnit {
  if (spanMs === null) return "month";
  if (spanMs <= 6 * HOUR_MS) return "minute";
  if (spanMs <= 5 * DAY_MS) return "hour";
  if (spanMs <= 120 * DAY_MS) return "day";
  if (spanMs <= 3 * 365 * DAY_MS) return "week";
  return "month";
}

export interface RangeInput {
  range?: string | null;
  from?: string | null;
  to?: string | null;
  bucket?: string | null;
}

export interface RangeOptions {
  timezone: string;
  /** Day of the month the billing cycle rolls over on. */
  cycleDay: number;
  now?: Date;
}

export interface ResolvedRange {
  preset: RangePreset;
  /** Inclusive start, or null for "everything ever recorded". */
  from: Date | null;
  /** Exclusive end. */
  to: Date;
  bucket: BucketUnit;
  /** Echoed back so a custom range survives a round trip through the URL. */
  from_input: string | null;
  to_input: string | null;
}

/** Local midnight at the start of the day `date` ("YYYY-MM-DD") falls on. */
function startOfLocalDay(date: string, timezone: string, dayOffset = 0): Date {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + dayOffset));
  return zonedTimeToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    0,
    0,
    timezone,
  );
}

/** Monday-based, matching Postgres date_trunc on week. */
function startOfLocalWeek(date: string, timezone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return startOfLocalDay(date, timezone, -((weekday + 6) % 7));
}

function startOfLocalYear(date: string, timezone: string): Date {
  return zonedTimeToUtc(Number(date.slice(0, 4)), 1, 1, 0, 0, 0, timezone);
}

/**
 * Parse one end of a custom range. A bare date means local midnight; adding a
 * time means that exact local instant. `endOfDay` pushes a bare date to the
 * following midnight, so a custom range reads as inclusive of its last day.
 */
function parseEndpoint(value: string, timezone: string, endOfDay: boolean): Date {
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return startOfLocalDay(trimmed, timezone, endOfDay ? 1 : 0);
  }

  const dateTime = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (dateTime) {
    const [, y, mo, d, h, mi, s] = dateTime;
    return zonedTimeToUtc(+y, +mo, +d, +h, +mi, +(s ?? 0), timezone);
  }

  throw new InvalidRangeError(
    "badEndpoint",
    { value: `"${value}"` },
    `"${value}" is not a date (YYYY-MM-DD) or a date and time (YYYY-MM-DDTHH:MM)`,
  );
}

function bounds(
  preset: RangePreset,
  input: RangeInput,
  timezone: string,
  cycleDay: number,
  now: Date,
): { from: Date | null; to: Date } {
  const today = localParts(now, timezone).date;

  switch (preset) {
    case "last_hour":
      return { from: new Date(now.getTime() - HOUR_MS), to: now };
    case "last_6h":
      return { from: new Date(now.getTime() - 6 * HOUR_MS), to: now };
    case "last_24h":
      return { from: new Date(now.getTime() - DAY_MS), to: now };
    case "last_7d":
      return { from: new Date(now.getTime() - 7 * DAY_MS), to: now };
    case "last_30d":
      return { from: new Date(now.getTime() - 30 * DAY_MS), to: now };
    case "last_90d":
      return { from: new Date(now.getTime() - 90 * DAY_MS), to: now };
    case "today":
      return { from: startOfLocalDay(today, timezone), to: now };
    case "yesterday":
      return {
        from: startOfLocalDay(today, timezone, -1),
        to: startOfLocalDay(today, timezone),
      };
    case "this_week":
      return { from: startOfLocalWeek(today, timezone), to: now };
    case "this_year":
      return { from: startOfLocalYear(today, timezone), to: now };
    case "this_cycle":
      return { from: cycleBounds(now, cycleDay, timezone).start, to: now };
    case "last_cycle": {
      const previous = cycleBounds(now, cycleDay, timezone, -1);
      return { from: previous.start, to: previous.end };
    }
    case "all_time":
      return { from: null, to: now };
    case "custom": {
      if (!input.from || !input.to) {
        throw new InvalidRangeError(
          "customNeedsBoth",
          {},
          "a custom range needs both a start and an end",
        );
      }
      const from = parseEndpoint(input.from, timezone, false);
      const to = parseEndpoint(input.to, timezone, true);
      if (to.getTime() <= from.getTime()) {
        throw new InvalidRangeError(
          "customOrder",
          {},
          "the end of a custom range must be after its start",
        );
      }
      return { from, to };
    }
  }
}

export function resolveRange(input: RangeInput, options: RangeOptions): ResolvedRange {
  const { timezone, cycleDay } = options;
  const now = options.now ?? new Date();

  const requested = input.range?.trim() || DEFAULT_PRESET;
  if (!isRangePreset(requested)) {
    throw new InvalidRangeError(
      "unknownPreset",
      { value: `"${requested}"` },
      `unknown range "${requested}"`,
    );
  }

  const { from, to } = bounds(requested, input, timezone, cycleDay, now);
  const spanMs = from === null ? null : to.getTime() - from.getTime();

  let bucket = chooseBucket(spanMs);
  const override = input.bucket?.trim();
  if (override) {
    if (!isBucket(override)) {
      throw new InvalidRangeError(
        "unknownBucket",
        { value: `"${override}"` },
        `unknown bucket "${override}"`,
      );
    }
    if (spanMs !== null && spanMs / BUCKET_MS[override] > MAX_BUCKETS) {
      throw new InvalidRangeError(
        "tooManyBuckets",
        { bucket: override, max: MAX_BUCKETS },
        `${override} buckets over this range would produce more than ${MAX_BUCKETS} points`,
      );
    }
    bucket = override;
  }

  return {
    preset: requested,
    from,
    to,
    bucket,
    from_input: requested === "custom" ? (input.from ?? null) : null,
    to_input: requested === "custom" ? (input.to ?? null) : null,
  };
}
